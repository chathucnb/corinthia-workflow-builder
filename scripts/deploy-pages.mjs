/**
 * Builds the site and publishes dist/ to the gh-pages branch (GitHub Pages).
 * Run with: npm run deploy
 */
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', ...opts });
const out = (cmd) => execSync(cmd).toString().trim();

const remote = out('git remote get-url origin');
const repo = remote.replace(/\.git$/, '').split('/').pop();
const base = `/${repo}/`;

console.log(`Building for ${base} …`);
run('npm test');
run('npm run build', { env: { ...process.env, BASE_PATH: base } });
writeFileSync('dist/.nojekyll', ''); // serve files as-is

const sha = out('git rev-parse --short HEAD');
const git = (args) => run(`git ${args}`, { cwd: 'dist' });
git('init -q -b gh-pages');
git('add -A');
git(`-c user.name="${out('git config user.name')}" -c user.email="${out('git config user.email')}" commit -q -m "Deploy ${sha}"`);
git(`push -q -f ${remote} gh-pages`);
console.log(`Published ${sha} to the gh-pages branch.`);
