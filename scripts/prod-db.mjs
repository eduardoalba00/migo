import { execSync, spawn } from 'child_process'
import { readFileSync } from 'fs'
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

spawn('docker', ['exec', '-it', containerId, 'psql', '-U', env.POSTGRES_USER, '-d', env.POSTGRES_DB], {
  stdio: 'inherit',
})
