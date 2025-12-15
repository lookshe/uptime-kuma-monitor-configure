const util = require("node:util");
const fs = require("fs");
const yaml = require("js-yaml");
const { DatabaseSync } = require("node:sqlite");

let database;

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
  if (!fs.existsSync(params.config) || !fs.lstatSync(params.config).isFile()) {
    throw new Error(`config file "${params.config}" not existing`);
  }
  try {
    fs.accessSync(params.config, fs.constants.R_OK);
  } catch (error) {
    throw new Error(`config file "${params.config}" not readable`, {
      cause: error,
    });
  }
  if (!fs.existsSync(params.database) || !fs.lstatSync(params.database).isFile()) {
    throw new Error(`database file "${params.database}" not existing`);
  }
  try {
    fs.accessSync(params.database, fs.constants.R_OK | fs.constants.W_OK);
  } catch (error) {
    throw new Error(`database file "${params.database}" not writeable`, {
      cause: error,
    });
  }
  return { configFile: params.config, databaseFile: params.database };
}

async function updateMonitorWithDefaults(id) {
  const defaults = {};
  defaults.user_id = 1;
  defaults.interval = 60;
  defaults.retry_interval = 60;
  defaults.timeout = 48;
  const defaultsString = Object.entries(defaults)
    .map(([key, value]) => `${key} = ${value}`)
    .join(",");
  const stmt = database.prepare(`UPDATE monitor SET ${defaultsString} WHERE id = :id`);
  stmt.run({ ":id": id });
}

async function createGroup(name, parentId) {
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
  if (parentId) {
    const stmt = database.prepare("INSERT INTO monitor(name, type, parent) VALUES(:name, :type, :parent)");
    result = stmt.run({ ":name": name, ":type": "group", ":parent": parentId });
  } else {
    const stmt = database.prepare("INSERT INTO monitor(name, type) VALUES(:name, :type)");
    result = stmt.run({ ":name": name, ":type": "group" });
  }
  await updateMonitorWithDefaults(result.lastInsertRowid);
  return result.lastInsertRowid;
}

async function createMonitor(name, monitor, parentId, ips = undefined) {
  if (ips) {
    for (const [ipKey, ip] of Object.entries(ips)) {
      const newName = name + (ipKey === "v4" ? "" : " - " + ipKey);
      const newMonitor = { ...monitor };
      Object.keys(newMonitor).forEach((monitorKey) => {
        newMonitor[monitorKey] = newMonitor[monitorKey].replace("$$IP$$", ip);
      });
      await createMonitor(newName, newMonitor, parentId);
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
    const keys = Object.keys(monitor);
    const columns = keys.join(",");
    const params = keys.map((k) => `:${k}`).join(",");
    // prefix keys with ":" to use as named parameters
    const namedParams = Object.keys(monitor).reduce((a, c) => ((a[`:${c}`] = monitor[c]), a), {});
    const stmt = database.prepare(`REPLACE INTO monitor(${columns}) VALUES(${params})`);
    result = stmt.run(namedParams);
    await updateMonitorWithDefaults(result.lastInsertRowid);
  }
}

async function loopGroup(group, parentId = undefined, ipsParent = undefined) {
  if (group.monitors) {
    for (const [monitorKey, monitor] of Object.entries(group.monitors)) {
      const ips = monitor.ips === undefined ? ipsParent : monitor.ips;
      if (monitor.type === "group") {
        const id = await createGroup(monitorKey, parentId);
        await loopGroup(monitor, id, ips);
      } else {
        await createMonitor(monitorKey, monitor, parentId, ips);
      }
    }
  }
}

async function main() {
  const { configFile, databaseFile } = await validateInput();
  const config = yaml.load(fs.readFileSync(configFile));
  database = new DatabaseSync(databaseFile, { open: true });
  await loopGroup(config);
  database.close();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
