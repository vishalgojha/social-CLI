const chalk = require('chalk');
const config = require('../lib/config');

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
    hints.push('No tokens are configured. Start with: meta auth login -a facebook');
  } else {
    if (!tokens.facebook) hints.push('Missing Facebook token: meta auth login -a facebook');
    if (!tokens.instagram) hints.push('Missing Instagram token: meta auth login -a instagram');
    if (!tokens.whatsapp) hints.push('Missing WhatsApp token: meta auth login -a whatsapp');
  }

  if (!appCredentialsConfigured) {
    hints.push('App credentials not set (needed for OAuth and token debugging): meta auth app');
  }

  if (!defaults.marketingAdAccountId) {
    hints.push('No default ad account set (Marketing API): meta marketing set-default-account act_<AD_ACCOUNT_ID>');
  }

  if (defaultApi && !tokens[defaultApi]) {
    hints.push(`Default API is "${defaultApi}" but its token is not set. Set a token or change default API.`);
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

function registerDoctorCommands(program) {
  program
    .command('doctor')
    .description('Quick diagnostics (config + setup hints)')
    .option('--json', 'Output as JSON')
    .action((options) => {
      const snapshot = buildSnapshot();

      if (options.json) {
        console.log(JSON.stringify(snapshot, null, 2));
        return;
      }

      // Keep output consistent with existing commands.
      config.display();

      if (snapshot.hints.length) {
        console.log(chalk.bold('Next Steps:'));
        snapshot.hints.forEach((h) => console.log('  - ' + chalk.cyan(h)));
        console.log('');
      }
    });
}

module.exports = registerDoctorCommands;

