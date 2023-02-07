const R = require('ramda');
const { Client } = require('@elastic/elasticsearch');

const {
  env: {
    elasticLogs,
    elasticLogIndex = 'apilog_ti2',
    NODE_ENV: env,
  },
} = process;

class Plugin {
  constructor(params = {}) { // we get the env variables from here
    this.onRequestStart = this.onRequestStart.bind(this);
    this.onRequestEnd = this.onRequestEnd.bind(this);
    Object.entries(params).forEach(([attr, value]) => {
      this[attr] = value;
    });
    return (async () => {
      if (!elasticLogs) return this;
      const elasticLogsClient = new Client({ node: elasticLogs });
      this.elasticLogsClient = elasticLogsClient;

      const mappings = {
        dynamic: true,
        properties: {
          body: { type: 'object' },
          client: { type: 'keyword' },
          date: { type: 'long' },
          method: { type: 'keyword' },
          operationId: { type: 'keyword' },
          params: { type: 'object' },
          query: { type: 'object' },
          url: { type: 'text' },
          responseStatusCode: { type: 'long' },
          responseTimeInMs: { type: 'long' },
        },
      };
      // setup the index
      const { body } = await elasticLogsClient.indices.existsTemplate({
        name: 'apilog',
      });
      if (!body) {
        // the template has to be created
        console.log('=- creating index template -=');
        await elasticLogsClient.indices.putTemplate({
          name: 'apilog',
          body: {
            index_patterns: [`${elasticLogIndex}*`],
            settings: {
              number_of_shards: 1,
            },
            mappings,
          },
        });
        console.log('index template created');
      } else {
        // index exists, we might have to updated it
        const current = R.path(
          ['body', 'apilog', 'mappings'],
          await elasticLogsClient.indices.getTemplate({
            name: 'apilog',
          }),
        );
        if (!R.equals(current, mappings)) {
          console.log('=- updating index template -=');
          await elasticLogsClient.indices.putTemplate({
            name: 'apilog',
            body: {
              index_patterns: [`${elasticLogIndex}*`],
              settings: {
                number_of_shards: 1,
              },
              mappings,
            },
          });
          console.log('updated');
        }
      }
      const exists = await elasticLogsClient.indices.exists({
        index: elasticLogIndex,
      });
      if (!exists || !exists.body) {
        console.log('=- creating index =-');
        await elasticLogsClient.indices.create({
          index: elasticLogIndex,
        });
        console.log('index created');
      }
      return this;
    })();
  }

  eventHandler(eventEmmiter) {
    const eventsArr = (this.events2log || 'request.*').split(',');
    const pluginObj = this;
    eventsArr.forEach(eventName => {
      eventEmmiter.on(eventName, async function (body) {
        await pluginObj.elasticLogsClient.index({
          index: elasticLogIndex,
          id: body.requestId,
          body: {
            env,
            ...body,
            eventType: this.event,
          },
        });
      });
    });
  }
}

module.exports = Plugin;
