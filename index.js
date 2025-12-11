const util = require('node:util');
const fs = require('fs');
const yaml = require('js-yaml');

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

async function main() {
  const {configFile, databaseFile} = await validateInput();
  const config = yaml.load(fs.readFileSync(configFile));
  // todo: iterate config, check database by name and group(s), insert/replace
  // only for testing/debugging
  console.log(config.monitors['us.proxy']);
}

main().catch(console.error);
