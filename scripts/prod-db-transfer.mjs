import { execSync, spawnSync } from 'child_process'
import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'

const envFile = readFileSync(resolve(import.meta.dirname, '..', '.env.prod'), 'utf-8')
const env = Object.fromEntries(
  envFile.split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split('=', 2))
)

const containerId = execSync('docker ps -qf name=postgres', { encoding: 'utf-8' }).trim()
if (!containerId) {
  console.error('No running postgres container found.')
  process.exit(1)
}

const command = process.argv[2]

if (command === 'dump') {
  const outFile = resolve(import.meta.dirname, '..', 'migo-backup.sql')
  console.log('Dumping database...')
  const result = spawnSync('docker', [
    'exec', containerId,
    'pg_dump', '-U', env.POSTGRES_USER, '-d', env.POSTGRES_DB, '--clean', '--if-exists'
  ], { encoding: 'utf-8', maxBuffer: 100 * 1024 * 1024 })

  if (result.status !== 0) {
    console.error('pg_dump failed:', result.stderr)
    process.exit(1)
  }

  writeFileSync(outFile, result.stdout)
  console.log(`Dump saved to ${outFile}`)

} else if (command === 'restore') {
  const file = process.argv[3]
  if (!file) {
    console.error('Usage: node scripts/prod-db-transfer.mjs restore <file>')
    process.exit(1)
  }

  const sqlPath = resolve(file)
  const sql = readFileSync(sqlPath, 'utf-8')

  console.log('Stopping server container...')
  spawnSync('docker', ['compose', '-f', 'docker-compose.prod.yml', 'stop', 'server'], { stdio: 'inherit' })

  console.log('Restoring database...')
  const result = spawnSync('docker', [
    'exec', '-i', containerId,
    'psql', '-U', env.POSTGRES_USER, '-d', env.POSTGRES_DB
  ], { input: sql, stdio: ['pipe', 'inherit', 'inherit'], maxBuffer: 100 * 1024 * 1024 })

  if (result.status !== 0) {
    console.error('Restore failed.')
    process.exit(1)
  }

  console.log('Restarting server container...')
  spawnSync('docker', ['compose', '-f', 'docker-compose.prod.yml', 'start', 'server'], { stdio: 'inherit' })

  console.log('Restore complete.')

} else {
  console.error('Usage:')
  console.error('  node scripts/prod-db-transfer.mjs dump              — dump to migo-backup.sql')
  console.error('  node scripts/prod-db-transfer.mjs restore <file>    — restore from SQL file')
  process.exit(1)
}
