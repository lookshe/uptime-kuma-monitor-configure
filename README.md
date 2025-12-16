# uptime-kuma-monitor-configure

Configure monitors for [Uptime Kuma](https://github.com/louislam/uptime-kuma) directly in its SQLite database using a YAML configuration file.

## Features
- define monitors and groups in a simple YAML file
- supports nested groups and inheritance of defaults
- automatically creates or updates monitors in the Uptime Kuma SQLite database
- handles IPv4/IPv6 substitution with `$$IP$$` placeholder
- apply safe defaults (`user_id: 1`, `interval: 60`, `retry_interval: 60`, `timeout: 48`) if not specified
- works directly with the database (no need for API calls)

## Requirements
- Node.js 22.x (or later)
- npm (comes with Node.js)

## Installation

Clone the repository and install dependencies:

```bash
git clone https://git.fucktheforce.de/lookshe/uptime-kuma-monitor-configure.git
cd uptime-kuma-monitor-configure
npm ci --omit=dev
```

## Usage

Make sure to stop Uptime Kuma before running the script to avoid problems. Run the script with the required arguments:

```bash
node index.js --config config.yml --database /path/to/uptime-kuma/kuma.db
```

## Configuration

For an example configuration look at `config.example.yml`.
YAML also supports anchors (`&`) and references (`*`) for reusage of monitors.
`$$IP$$` can be used as placeholder for configured ip addresses from group parents.

## Caveats
- stop Uptime Kuma before execution to avoid database locks
- always back up your Uptime Kuma database before running the script
- the script uses `REPLACE INTO` for database operations, which may overwrite existing rows
