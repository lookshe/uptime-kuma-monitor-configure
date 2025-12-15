const util = require('node:util');
const fs = require('fs');
const yaml = require('js-yaml');
const { DatabaseSync } = require('node:sqlite');

let database;

async function parseCommandLineArgs() {
  const { values } = util.parseArgs({
    args: process.argv.slice(2),
    options: {
      config: { type: 'string', short: 'c' },
      database: { type: 'string', short: 'd' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: false,
  });
  return values;
}

async function printHelp() {
  console.log('Options:');
  console.log('--config|-c FILE   : path to configuration file in json format (required)');
  console.log('--database|-d FILE : path to uptime-kuma sqlite database (required)');
  console.log('--help|h           : print this help and exit');
}

async function validateInput() {
  const params = await parseCommandLineArgs();
  if (params.help) {
    await printHelp();
    process.exit(0);
  }
  if (!params.config || !params.database) {
    printHelp();
    process.exit(1);
  }
  if (!fs.existsSync(params.config) || !fs.lstatSync(params.config).isFile()) {
    console.error('config file "' + params.config + '" not existing')
    process.exit(1);
  }
  try {
     fs.accessSync(params.config, fs.constants.R_OK)
  } catch (error) {
    console.error('config file "' + params.config + '" not readable')
    process.exit(1);
  }
  if (!fs.existsSync(params.database) || !fs.lstatSync(params.database).isFile()) {
    console.error('database file "' + params.database + '" not existing')
    process.exit(1);
  }
  try {
     fs.accessSync(params.database, fs.constants.R_OK | fs.constants.W_OK)
  } catch (error) {
    console.error('database file "' + params.database + '" not writeable')
    process.exit(1);
  }
  return { configFile: params.config, databaseFile: params.database };
}

async function createGroup(name, parentId) {
  let result;
  if (parentId) {
    const stmt = database.prepare("SELECT id from monitor WHERE name = :name AND parent = :parent AND type = 'group'");
    result = stmt.get({':name': name, ':parent': parentId});
  } else {
    const stmt = database.prepare("SELECT id from monitor WHERE name = :name AND parent is null AND type = 'group'");
    result = stmt.get({':name': name});
  }
  if (result) {
    return result.id;
  }
  // create group
}

async function createMonitor(name, monitor, parentId, ips = undefined) {
  if (ips) {
    for (ipKey in ips) {
      const newName = name + (ipKey === 'v4' ? '' : ' - ' + ipKey);
      const newMonitor = { ... monitor }
      Object.keys(newMonitor).forEach(monitorKey => {
        newMonitor[monitorKey] = newMonitor[monitorKey].replace('$$IP$$', ips[ipKey])
      });
      await createMonitor(newName, newMonitor, parentId)
    }
  } else {
    let result;
    if (parentId) {
      const stmt = database.prepare("SELECT id from monitor WHERE name = :name AND parent = :parent");
      result = stmt.get({':name': name, ':parent': parentId});
    } else {
      const stmt = database.prepare("SELECT id from monitor WHERE name = :name AND parent is null");
      result = stmt.get({':name': name});
    }
    if (result) {
      // update monitor
    } else {
      // create monitor
    }
  }
}

async function loopGroup(group, parentId = undefined, ipsParent = undefined) {
  for (monitorKey in group.monitors) {
    monitor = group.monitors[monitorKey];
    ips = monitor.ips === undefined ? ipsParent : monitor.ips;
    if (monitor.type === 'group') {
      id = await createGroup(monitorKey, parentId)
      await loopGroup(monitor, id, ips)
    } else {
      await createMonitor(monitorKey, monitor, parentId, ips)
    }
  }
}

async function main() {
  const {configFile, databaseFile} = await validateInput();
  const config = yaml.load(fs.readFileSync(configFile));
  database = new DatabaseSync(databaseFile, {open: true, readOnly: true})
  await loopGroup(config);
  database.close();
}

main().catch(console.error);
