// Publie une nouvelle version : npm run release
// 1. vérifie que tout est commité et poussé, que le tag existe et qu'aucune Release n'existe pour cette version
// 2. construit l'installeur
// 3. crée la Release GitHub (exe + latest.yml + blockmap) avec gh
// La version publiée est celle de package.json : faire `npm version patch|minor` avant.
const { execSync } = require('child_process');
const fs = require('fs');

const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', ...opts });
const out = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();
const die = (msg) => {
  console.error(`\n✖ ${msg}`);
  process.exit(1);
};

const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const tag = `v${version}`;

if (out('git status --porcelain')) die('Des modifications ne sont pas commitées.');
run('git fetch origin --tags');
if (out('git rev-parse HEAD') !== out('git rev-parse @{u}')) die('La branche locale diffère de origin : faites git push.');
let released = true;
try {
  out(`gh release view ${tag}`);
} catch {
  released = false;
}
if (released) die(`La Release ${tag} existe déjà : incrémentez la version (npm version patch).`);
if (!out('git tag --list ' + tag)) die(`Le tag ${tag} est absent : lancez npm version patch puis git push --follow-tags.`);

run('npm run dist');

const files = [`release/Playou4-Setup-${version}.exe`, `release/Playou4-Setup-${version}.exe.blockmap`, 'release/latest.yml'];
for (const f of files) if (!fs.existsSync(f)) die(`Fichier manquant : ${f}`);

run(`gh release create ${tag} ${files.map((f) => `"${f}"`).join(' ')} --title "Playou4 ${version}" --generate-notes`);
console.log(`\n✔ Release ${tag} publiée.`);
