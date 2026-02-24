const { MetaApiClient } = require('./api');
const configSingleton = require('./config');

// Back-compat wrapper: keep the old class name used throughout the repo,
// but route all requests through lib/api.js (shared error handling/retries).
class MetaAPIClient extends MetaApiClient {
  constructor(token, api = 'facebook', opts = {}) {
    const cfg = opts.config || configSingleton;
    const apiVersion = opts.apiVersion || (cfg && typeof cfg.getApiVersion === 'function' ? cfg.getApiVersion() : 'v20.0');
    super({ token, apiVersion });
    this.api = api;
  }

  // Common API calls
  async getMe(fields = 'id,name,email', opts = {}) {
    return this.get('/me', { fields }, opts);
  }

  async getAppInfo(appId) {
    return this.get(`/${appId}`, {
      fields: 'id,name,namespace,category,link,icon_url,logo_url,daily_active_users,weekly_active_users,monthly_active_users'
    });
  }

  async debugToken(tokenToDebug) {
    return this.get('/debug_token', { input_token: tokenToDebug });
  }

  // Facebook
  async getFacebookPages(limit = 25) {
    return this.get('/me/accounts', {
      fields: 'id,name,access_token,category,fan_count,instagram_business_account',
      limit
    });
  }

  async postToPage(pageId, payload) {
    return this.post(`/${pageId}/feed`, payload);
  }

  // Instagram Graph
  async getInstagramMedia(igUserId, limit = 10) {
    return this.get(`/${igUserId}/media`, {
      fields: 'id,caption,media_type,media_url,permalink,timestamp,thumbnail_url',
      limit
    });
  }

  async getInstagramInsights(mediaId, metric, period) {
    const params = { metric };
    if (period) params.period = period;
    return this.get(`/${mediaId}/insights`, params);
  }

  async listInstagramComments(mediaId, limit = 50) {
    return this.get(`/${mediaId}/comments`, { fields: 'id,text,timestamp,username', limit });
  }

  async replyToInstagramComment(commentId, message) {
    return this.post(`/${commentId}/replies`, { message });
  }

  async publishInstagramContainer(igUserId, containerId) {
    return this.post(`/${igUserId}/media_publish`, { creation_id: containerId });
  }

  // WhatsApp Cloud API
  async sendWhatsAppMessage(phoneNumberId, body) {
    return this.post(`/${phoneNumberId}/messages`, body);
  }

  async listWhatsAppTemplates(wabaId, limit = 50) {
    return this.get(`/${wabaId}/message_templates`, { limit });
  }

  async createWhatsAppTemplate(wabaId, payload) {
    return this.post(`/${wabaId}/message_templates`, payload);
  }

  async listWhatsAppPhoneNumbers(wabaId) {
    return this.get(`/${wabaId}/phone_numbers`, { fields: 'id,display_phone_number,verified_name,quality_rating,name_status' });
  }
}

module.exports = MetaAPIClient;
