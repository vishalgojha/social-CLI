const chalk = require('chalk');
const config = require('../lib/config');
const { t } = require('../lib/i18n');

function buildSnapshot() {
  const activeProfile = config.getActiveProfile();
  const profiles = config.listProfiles();

  const apiVersion = config.getApiVersion();
  const defaultApi = config.getDefaultApi();

  const tokens = {
    facebook: config.hasToken('facebook'),
    instagram: config.hasToken('instagram'),
    whatsapp: config.hasToken('whatsapp')
  };

  const appCredentialsConfigured = config.hasAppCredentials();

  const defaults = {
    facebookPageId: config.getDefaultFacebookPageId(),
    igUserId: config.getDefaultIgUserId(),
    whatsappPhoneNumberId: config.getDefaultWhatsAppPhoneNumberId(),
    marketingAdAccountId: config.getDefaultMarketingAdAccountId()
  };

  const hints = [];

  if (!tokens.facebook && !tokens.instagram && !tokens.whatsapp) {
    hints.push(t('doctor_no_tokens'));
  } else {
    if (!tokens.facebook) hints.push(t('doctor_missing_facebook'));
    if (!tokens.instagram) hints.push(t('doctor_missing_instagram'));
    if (!tokens.whatsapp) hints.push(t('doctor_missing_whatsapp'));
  }

  if (!appCredentialsConfigured) {
    hints.push(t('doctor_missing_app_creds'));
  }

  if (!defaults.marketingAdAccountId) {
    hints.push(t('doctor_missing_ad_account'));
  }

  if (defaultApi && !tokens[defaultApi]) {
    hints.push(t('doctor_default_api_missing_token', { api: defaultApi }));
  }

  return {
    configPath: config.getConfigPath(),
    activeProfile,
    profiles,
    apiVersion,
    defaultApi,
    tokens,
    appCredentialsConfigured,
    defaults,
    hints
  };
}

function runDoctor(options) {
  const snapshot = buildSnapshot();

  if (options.json) {
    console.log(JSON.stringify(snapshot, null, 2));
    return;
  }

  // Keep output consistent with existing commands.
  config.display();

  if (snapshot.hints.length) {
    console.log(chalk.bold(t('doctor_next_steps')));
    snapshot.hints.forEach((h) => console.log('  - ' + chalk.cyan(h)));
    console.log('');
  }
}

function addDoctorLikeCommand(command, { name, description }) {
  return command
    .command(name)
    .description(description)
    .option('--json', 'Output as JSON')
    .action(runDoctor);
}

function registerDoctorCommands(program) {
  addDoctorLikeCommand(program, {
    name: 'doctor',
    description: 'Quick diagnostics (config + setup hints)'
  });

  // Aliases for muscle memory / simplified UX.
  addDoctorLikeCommand(program, {
    name: 'status',
    description: 'Alias for "doctor"'
  });
  addDoctorLikeCommand(program, {
    name: 'config',
    description: 'Alias for "doctor"'
  });
  addDoctorLikeCommand(program, {
    name: 'diag',
    description: 'Alias for "doctor"'
  });
}

module.exports = registerDoctorCommands;
