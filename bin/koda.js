#!/usr/bin/env node

import { Command } from 'commander';
import { execa } from 'execa';
import chalk from 'chalk';
import ora from 'ora';
import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import os from 'os';
import * as tar from 'tar';
import { Readable } from 'stream';
import { finished } from 'stream/promises';

const program = new Command();
const KODA_DIR = path.join(os.homedir(), '.koda');
const REPO_URL = 'https://github.com/cher1shRXD/koda-backend/archive/refs/heads/main.tar.gz';

async function checkDependency(name) {
  try {
    await execa(name, ['--version']);
    return true;
  } catch {
    return false;
  }
}

async function ensureDeps(spinner) {
  const hasPnpm = await checkDependency('pnpm');
  const hasPm2 = await checkDependency('pm2');

  if (!hasPnpm || !hasPm2) {
    spinner.fail(chalk.red(`Missing dependencies: ${!hasPnpm ? 'pnpm ' : ''}${!hasPm2 ? 'pm2' : ''}`));
    console.log(chalk.yellow('Please run "koda setup" first.'));
    process.exit(1);
  }
}

async function downloadAndExtract(url, dest) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download: ${response.statusText}`);
  
  if (!existsSync(dest)) {
    await fs.mkdir(dest, { recursive: true });
  }

  const body = Readable.fromWeb(response.body);
  const extractor = tar.x({
    cwd: dest,
    strip: 1,
  });

  body.pipe(extractor);
  await finished(extractor);
}

program
  .name('koda')
  .description('CLI to manage koda-backend')
  .version('1.0.5');

program
  .command('setup')
  .description('Install global dependencies (pnpm, pm2)')
  .action(async () => {
    const spinner = ora('Installing pnpm and pm2...').start();
    try {
      await execa('npm', ['install', '-g', 'pnpm', 'pm2']);
      spinner.succeed(chalk.green('Dependencies (pnpm, pm2) installed successfully!'));
    } catch (error) {
      spinner.fail(chalk.red('Failed to install dependencies: ' + error.message));
    }
  });

program
  .command('install')
  .description('Install koda-backend')
  .action(async () => {
    const spinner = ora('Initializing installation...').start();
    await ensureDeps(spinner);

    try {
      if (existsSync(KODA_DIR)) {
        spinner.text = 'Removing existing koda-backend directory...';
        await fs.rm(KODA_DIR, { recursive: true, force: true });
      }

      spinner.text = 'Downloading and extracting koda-backend...';
      await downloadAndExtract(REPO_URL, KODA_DIR);

      spinner.text = 'Installing dependencies with pnpm...';
      await execa('pnpm', ['install'], { cwd: KODA_DIR });

      spinner.succeed(chalk.green(`koda-backend installed successfully in ${KODA_DIR}`));
    } catch (error) {
      spinner.fail(chalk.red('Failed to install koda-backend: ' + error.message));
    }
  });

program
  .command('start')
  .description('Start koda-backend using pm2')
  .action(async () => {
    const spinner = ora('Starting koda-backend...').start();
    await ensureDeps(spinner);

    if (!existsSync(KODA_DIR)) {
      spinner.fail(chalk.red('koda-backend is not installed. Run "koda install" first.'));
      return;
    }

    try {
      // Delete existing process to clear old pnpm-based configuration
      try {
        await execa('pm2', ['delete', 'koda-backend'], { shell: true });
      } catch {
        // Ignore if process doesn't exist
      }

      // Use 'node' as the interpreter to run 'main.js' directly
      await execa('pm2', ['start', 'main.js', '--name', 'koda-backend', '--interpreter', 'node'], { 
        cwd: KODA_DIR,
        shell: true 
      });
      spinner.succeed(chalk.green('koda-backend started successfully!'));
    } catch (error) {
      spinner.fail(chalk.red('Failed to start koda-backend: ' + error.message));
    }
  });

program
  .command('stop')
  .description('Stop koda-backend using pm2')
  .action(async () => {
    const spinner = ora('Stopping koda-backend...').start();
    await ensureDeps(spinner);

    try {
      await execa('pm2', ['stop', 'koda-backend'], { shell: true });
      spinner.succeed(chalk.green('koda-backend stopped successfully!'));
    } catch (error) {
      spinner.fail(chalk.red('Failed to stop koda-backend (it might not be running)'));
    }
  });

program
  .command('update')
  .description('Update koda-backend')
  .action(async () => {
    const spinner = ora('Updating koda-backend...').start();
    await ensureDeps(spinner);

    if (!existsSync(KODA_DIR)) {
      spinner.fail(chalk.red('koda-backend is not installed. Run "koda install" first.'));
      return;
    }

    try {
      spinner.text = 'Stopping koda-backend...';
      try {
        await execa('pm2', ['stop', 'koda-backend'], { shell: true });
      } catch {
        // Ignore if not running
      }

      const envPath = path.join(KODA_DIR, '.env');
      let envBackup = null;
      if (existsSync(envPath)) {
        spinner.text = 'Backing up .env...';
        envBackup = await fs.readFile(envPath, 'utf-8');
      }

      spinner.text = 'Downloading latest version...';
      const files = await fs.readdir(KODA_DIR);
      for (const file of files) {
        await fs.rm(path.join(KODA_DIR, file), { recursive: true, force: true });
      }

      await downloadAndExtract(REPO_URL, KODA_DIR);

      if (envBackup) {
        spinner.text = 'Restoring .env...';
        await fs.writeFile(envPath, envBackup);
      }

      spinner.text = 'Updating dependencies...';
      await execa('pnpm', ['install'], { cwd: KODA_DIR });

      spinner.text = 'Restarting koda-backend...';
      try {
        await execa('pm2', ['delete', 'koda-backend'], { shell: true });
      } catch {
        // Ignore
      }
      await execa('pm2', ['start', 'main.js', '--name', 'koda-backend', '--interpreter', 'node'], { 
        cwd: KODA_DIR,
        shell: true 
      });

      spinner.succeed(chalk.green('koda-backend updated and restarted successfully!'));
    } catch (error) {
      spinner.fail(chalk.red('Failed to update koda-backend: ' + error.message));
    }
  });

program
  .command('uninstall')
  .description('Permanently remove koda-backend')
  .action(async () => {
    const spinner = ora('Uninstalling koda-backend...').start();
    await ensureDeps(spinner);

    try {
      spinner.text = 'Stopping and deleting pm2 process...';
      try {
        await execa('pm2', ['delete', 'koda-backend'], { shell: true });
      } catch {
        // Ignore if process doesn't exist
      }

      spinner.text = 'Removing files...';
      if (existsSync(KODA_DIR)) {
        await fs.rm(KODA_DIR, { recursive: true, force: true });
      }

      spinner.succeed(chalk.green('koda-backend uninstalled successfully!'));
    } catch (error) {
      spinner.fail(chalk.red('Failed to uninstall koda-backend: ' + error.message));
    }
  });

program
  .command('clear')
  .description('Clear all files and folders inside koda-backend outputs directory')
  .action(async () => {
    const outputsDir = path.join(KODA_DIR, 'outputs');
    const spinner = ora('Clearing outputs directory...').start();

    if (!existsSync(outputsDir)) {
      spinner.info(chalk.yellow('Outputs directory does not exist, nothing to clear.'));
      return;
    }

    try {
      const files = await fs.readdir(outputsDir);
      for (const file of files) {
        await fs.rm(path.join(outputsDir, file), { recursive: true, force: true });
      }
      spinner.succeed(chalk.green('Outputs directory cleared successfully!'));
    } catch (error) {
      spinner.fail(chalk.red('Failed to clear outputs directory: ' + error.message));
    }
  });

program.parse(process.argv);
