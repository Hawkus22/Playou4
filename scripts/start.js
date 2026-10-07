// Lance Electron en s'assurant que ELECTRON_RUN_AS_NODE n'est pas hérité (ex. terminal VS Code).
const { spawn } = require('child_process');
const electron = require('electron');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, process.argv.length > 2 ? process.argv.slice(2) : ['.'], { stdio: 'inherit', env });
child.on('close', (code) => process.exit(code ?? 0));
