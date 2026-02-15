const { spawn } = require('child_process');

function openUrl(url) {
  if (!url) return Promise.resolve(false);

  return new Promise((resolve) => {
    const platform = process.platform;
    let command;
    let args;

    if (platform === 'win32') {
      command = 'cmd';
      args = ['/c', 'start', '""', url];
    } else if (platform === 'darwin') {
      command = 'open';
      args = [url];
    } else {
      command = 'xdg-open';
      args = [url];
    }

    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.on('error', () => resolve(false));
    child.unref();
    resolve(true);
  });
}

module.exports = {
  openUrl
};

