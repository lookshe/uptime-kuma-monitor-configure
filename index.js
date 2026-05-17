const util = require("node:util");
const fs = require("fs");
const yaml = require("js-yaml");
const { DatabaseSync } = require("node:sqlite");

let database;

const replaceString = "\\$\\$";

const helpString =
  "Options:\n" +
  "--config|-c FILE   : path to configuration file in yaml format (required)\n" +
  "--database|-d FILE : path to uptime-kuma sqlite database (required)\n" +
  "--help|h           : print this help and exit";

async function parseCommandLineArgs() {
  const { values } = util.parseArgs({
    args: process.argv.slice(2),
    options: {
      config: { type: "string", short: "c" },
      database: { type: "string", short: "d" },
      help: { type: "boolean", short: "h" },
    },
    strict: false,
  });
  return values;
}

async function validateInput() {
  const params = await parseCommandLineArgs();
  if (params.help) {
    console.log(helpString);
    process.exit(0);
  }
  if (!params.config || !params.database) {
    throw new Error(helpString);
  }
  if (!(await fs.promises.stat(params.config)).isFile()) {
    throw new Error(`config file "${params.config}" not existing`);
  }
  try {
    await fs.promises.access(params.config, fs.constants.R_OK);
  } catch (error) {
    throw new Error(`config file "${params.config}" not readable`, {
      cause: error,
    });
  }
  if (!(await fs.promises.stat(params.database)).isFile()) {
    throw new Error(`database file "${params.database}" not existing`);
  }
  try {
    await fs.promises.access(params.database, fs.constants.R_OK | fs.constants.W_OK);
  } catch (error) {
    throw new Error(`database file "${params.database}" not writeable`, {
      cause: error,
    });
  }
  return { configFile: params.config, databaseFile: params.database };
}

async function replaceMonitor(inputMonitor) {
  const defaults = {
    user_id: 1,
    interval: 60,
    retry_interval: 60,
    timeout: 48,
  };
  const oldMonitor = {};
  if (inputMonitor.id) {
    const oldData = database.prepare(`SELECT * FROM monitor where id = :id`).get({ ":id": inputMonitor.id });
    if (oldData) {
      for (const [key, value] of Object.entries(oldData)) {
        if (value !== null) {
          oldMonitor[key] = value;
        }
      }
    }
  }
  const monitor = { ...defaults, ...oldMonitor, ...inputMonitor };
  const keys = Object.keys(monitor);
  const columns = keys.join(",");
  const params = keys.map((k) => `:${k}`).join(",");
  // prefix keys with ":" to use as named parameters
  const namedParams = Object.keys(monitor).reduce((a, c) => ((a[`:${c}`] = monitor[c]), a), {});
  const stmt = database.prepare(`REPLACE INTO monitor(${columns}) VALUES(${params})`);
  const result = stmt.run(namedParams);
  return result.lastInsertRowid;
}

async function createOrUpdateGroup(name, parentId) {
  let result;
  if (parentId) {
    const stmt = database.prepare("SELECT id from monitor WHERE name = :name AND parent = :parent AND type = 'group'");
    result = stmt.get({ ":name": name, ":parent": parentId });
  } else {
    const stmt = database.prepare("SELECT id from monitor WHERE name = :name AND parent is null AND type = 'group'");
    result = stmt.get({ ":name": name });
  }
  if (result) {
    return result.id;
  }
  const monitor = { name: name, type: "group" };
  if (parentId) {
    monitor.parent = parentId;
  }
  return await replaceMonitor(monitor);
}

async function monitorContainsReplacement(monitor) {
  return Object.values(monitor).some((value) => 
    String(value).match(new RegExp(replaceString + ".*" + replaceString))
  );
}

async function monitorContainsReplacementKey(monitor, key) {
  const regex = new RegExp(replaceString + key + replaceString);
  return Object.values(monitor).some((value) =>
    String(value).match(regex) !== null
  );
}

async function createOrUpdateMonitor(name, monitor, parentId, replacements = {}) {
  if (Object.keys(replacements).length > 0 && await monitorContainsReplacement(monitor)) {
    const replacementKeys = [];
    for (const key in replacements) {
      if (await monitorContainsReplacementKey(monitor, key)) {
        replacementKeys.push(key);
      }
    }
    const containedReplacements = Object.entries(replacements).filter(([r, v]) => replacementKeys.includes(r)).map(([categoryName, entries]) => {
      return {
        name: categoryName,
        items: Object.entries(entries).map(([key, value]) => ({ key, value }))
      };
    });
    // cartesian product reducer
    const cartesian = (arrays) =>
      arrays.reduce((acc, curr) =>
        acc.flatMap(a => curr.map(b => [...a, b]))
      , [[]]);
    // build replacement combinations
    const combinations = cartesian(containedReplacements.map(c => c.items)).map(combo => {
      const obj = {};
      combo.forEach((item, index) => {
        const categoryName = containedReplacements[index].name;
        obj[categoryName] = item;
      });
      return obj;
    });
    // build monitor out of all combinations
    for (const combination of combinations) {
      const newMonitor = { ...monitor };
      let newName = name;
      for (const replacementKey of Object.keys(combination)) {
        Object.keys(newMonitor).forEach((monitorKey) => {
          const regex = new RegExp(replaceString + replacementKey + replaceString);
          if (String(newMonitor[monitorKey]).match(regex) !== null) {
            newName += (combination[replacementKey].key === "default" ? "" : " - " + combination[replacementKey].key);
            newMonitor[monitorKey] = newMonitor[monitorKey].replace(regex, combination[replacementKey].value);
          }
        });
      }
      await createOrUpdateMonitor(newName, newMonitor, parentId);
    }
  } else {
    let result;
    if (parentId) {
      const stmt = database.prepare("SELECT id from monitor WHERE name = :name AND parent = :parent");
      result = stmt.get({ ":name": name, ":parent": parentId });
    } else {
      const stmt = database.prepare("SELECT id from monitor WHERE name = :name AND parent is null");
      result = stmt.get({ ":name": name });
    }
    // if monitor already exists, add its id for replacing
    if (result) {
      monitor.id = result.id;
    }
    // the name is needed in the monitor data
    monitor.name = name;
    // and so is the parent when exists
    if (parentId) {
      monitor.parent = parentId;
    }
    return await replaceMonitor(monitor);
  }
}

async function loopGroup(group, parentId = undefined, replacementsParent = {}) {
  if (group.monitors) {
    for (const [monitorKey, monitor] of Object.entries(group.monitors)) {
      const replacements = {...replacementsParent,...monitor.replacements};
      if (monitor.type === "group") {
        const id = await createOrUpdateGroup(monitorKey, parentId);
        await loopGroup(monitor, id, replacements);
      } else {
        await createOrUpdateMonitor(monitorKey, monitor, parentId, replacements);
      }
    }
  }
}

async function main() {
  const { configFile, databaseFile } = await validateInput();
  const config = yaml.load(await fs.promises.readFile(configFile));
  database = new DatabaseSync(databaseFile, { open: true });
  database.exec("PRAGMA foreign_keys = OFF;");
  await loopGroup(config);
  database.exec("PRAGMA foreign_keys = ON;");
  database.close();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
