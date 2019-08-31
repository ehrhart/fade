/* eslint-disable no-console */
const debug = require('debug')('fade:index');
const argv = require('minimist')(process.argv.slice(2));
const balanced = require('balanced-match');
const dialogflow = require('dialogflow');
const fs = require('fs');
const parse = require('csv-parse');
const path = require('path');
const util = require('util');
const sparqlTransformer = require('sparql-transformer').default;

const permuter = require('./permuter');

const globalConfig = JSON.parse(
  fs.readFileSync(process.argv[2] || 'intents.json', {
    encoding: 'utf8'
  })
);

function logIntent(intent) {
  // Instantiates clients
  const contextsClient = new dialogflow.ContextsClient();
  const intentsClient = new dialogflow.IntentsClient();

  debug(`  ID:`, intentsClient.matchIntentFromIntentName(intent.name));
  debug(`  Display Name: ${intent.displayName}`);
  const outputContexts = intent.outputContexts
    .map(context => contextsClient.matchContextFromContextName(context.name))
    .join(', ');
  debug(`  Priority: ${intent.priority}`);
  debug(`  Output contexts: ${outputContexts}`);

  debug(`  Action: ${intent.action}`);
  debug(`  Parameters:`);
  intent.parameters.forEach(parameter => {
    debug(`    ${parameter.displayName}: ${parameter.entityTypeDisplayName}`);
  });

  debug(`  Responses:`);
  intent.messages.forEach(message => {
    const messageContent = JSON.stringify(message[message.message]);
    debug(`    (${message.platform}) ${message.message}: ${messageContent}`);
  });

  const defaultResponsePlatforms = intent.defaultResponsePlatforms.join(', ');
  debug(`  Platforms using default responses: ${defaultResponsePlatforms}`);
  debug('');
}

function logEntityType(entityType) {
  // Instantiates client.
  const entityTypesClient = new dialogflow.EntityTypesClient();

  console.log(
    '  ID:',
    entityTypesClient.matchEntityTypeFromEntityTypeName(entityType.name)
  );
  console.log('  Display Name:', entityType.displayName);
  console.log(
    '  Auto expansion:',
    entityType.autoExpansionMode === 'AUTO_EXPANSION_MODE_DEFAULT'
  );
  if (!entityType.entities) {
    console.log('  No entity defined.');
  } else {
    console.log('  Entities: ');
    entityType.entities.forEach(entity => {
      if (entityType.kind === 'KIND_MAP') {
        console.log(`    ${entity.value}: ${entity.synonyms.join(', ')}`);
      } else {
        console.log(`    ${entity.value}`);
      }
    });
  }
  console.log('');
}

function partitionArray(array, size) {
  return array
    .map((e, i) => (i % size === 0 ? array.slice(i, i + size) : null))
    .filter(e => e);
}

function apiDialogflowUpdateIntent(intentId, languageCode, newIntentData) {
  const { projectId } = globalConfig.options.dialogflow;

  // Instantiates client
  const intentsClient = new dialogflow.IntentsClient();

  // The path to identify the intent to be updated.
  const intentPath = intentsClient.intentPath(projectId, intentId);

  // UpdateIntent does full snapshot updates. For incremental update
  // fetch the intent first then modify it.
  const getIntentRequest = {
    name: intentPath,
    languageCode,

    // It's important to have INTENT_VIEW_FULL here, otherwise the training
    // phrases are not returned and updating will remove all training phrases.
    intentView: 'INTENT_VIEW_FULL'
  };

  return new Promise((resolve, reject) => {
    debug(`Fetching intent ${intentId} (lang: ${languageCode})`);

    intentsClient
      .getIntent(getIntentRequest)
      .then(responses => {
        const intent = responses[0];

        // Replace the data of the intent.
        const keys = Object.keys(newIntentData);
        for (let i = 0; i < keys.length; i += 1) {
          intent[keys[i]] = newIntentData[keys[i]];
        }

        // Now update the intent.
        const updateIntentRequest = {
          intent,
          languageCode
        };

        debug(
          `Updating intent "${intent.displayName}" (id: ${intentId}, lang: ${languageCode})`
        );

        return intentsClient.updateIntent(updateIntentRequest);
      })
      .then(responses => {
        debug('Intent updated');
        if (argv.verbose) {
          logIntent(responses[0]);
        }
        resolve(responses);
      })
      .catch(err => {
        console.error(
          `Error while updating Intent ${intentId} (lang: ${languageCode}):`,
          err
        );
        debug(util.inspect(err.metadata, { showHidden: false, depth: null }));
        reject(err);
      });
  });
}

function apiDialogflowUpdateEntity(entityTypeId, languageCode, newEntityData) {
  const { projectId } = globalConfig.options.dialogflow;

  // Instantiates client
  const entityTypesClient = new dialogflow.EntityTypesClient();

  // The path to the entity type to be updated.
  const entityTypePath = entityTypesClient.entityTypePath(
    projectId,
    entityTypeId
  );

  // UpdateEntityType does full snapshot update. For incremental update
  // fetch the entity type first then modify it.
  const getEntityTypeRequest = {
    name: entityTypePath,
    languageCode
  };

  return new Promise((resolve, reject) => {
    debug(`Fetching entity ${entityTypeId} (lang: ${languageCode})`);

    entityTypesClient
      .getEntityType(getEntityTypeRequest)
      .then(responses => {
        const entityType = responses[0];

        // Replace the data of the entity.
        const keys = Object.keys(newEntityData);
        for (let i = 0; i < keys.length; i += 1) {
          entityType[keys[i]] = newEntityData[keys[i]];
        }

        // Now update the intent.
        const updateEntityRequest = {
          entityType,
          languageCode
        };

        debug(
          `Updating entity "${entityType.displayName}" (id: ${entityTypeId}, lang: ${languageCode})`
        );

        return entityTypesClient.updateEntityType(updateEntityRequest);
      })
      .then(responses => {
        debug('Entity updated');
        if (argv.verbose) {
          logEntityType(responses[0]);
        }
        resolve(responses);
      })
      .catch(err => {
        console.error(
          `Error while updating Entity ${entityTypeId} (lang: ${languageCode}):`,
          err
        );
        debug(util.inspect(err.metadata, { showHidden: false, depth: null }));
        reject(err);
      });
  });
}

async function trainIntentDialogflow(intent, data) {
  data = data || {};
  const { phrases = [], responses = [] } = data;
  const maxTrainingPhrases = 1000;

  return new Promise(async (resolve, reject) => {
    // Dialogflow
    const dialogflowPhrases = phrases.map((phrase, index) => ({
      type: phrase.trainingMode || 'EXAMPLE',
      parts: phrase.parts
        .filter(part => {
          if (part.entityType) {
            const entity = intent.entities.find(
              e => e.name === part.entityType
            );
            if (!entity) {
              console.warn(
                `Entity "${part.entityType}" (for phrase "${phrase.line}" at index ${index}) not found for intent "${intent.name}"`
              );
              return false;
            }
          }
          return true;
        })
        .map(part => {
          if (!part.entityType) {
            return part;
          }

          // Find the mapping for this entity
          const entity = intent.entities.find(e => e.name === part.entityType);

          // By default, entities type and alias are equal to their name
          let entityType = entity.name;
          let alias =
            entity.name.indexOf('@') === 0
              ? entity.name.substr(1)
              : entity.name;

          // If we have a specific mapping for Dialogflow, then use it
          if (entity.mapping && entity.mapping.dialogflow) {
            if (entity.mapping.dialogflow.type) {
              entityType = entity.mapping.dialogflow.type;
            }
            if (entity.mapping.dialogflow.name) {
              alias = entity.mapping.dialogflow.name;
            }
          }

          // Return a final object with the correct format for Dialogflow
          return {
            text: part.text.replace(`'`, ''),
            entityType,
            alias,
            user_defined: true
          };
        })
    }));

    // Generate permutations and add them to the training phrases
    const trainingMode =
      intent.settings.dialogflow.trainingMode ||
      globalConfig.options.dialogflow.trainingMode ||
      'EXAMPLE';
    if (trainingMode === 'TEMPLATE') {
      const primaryEntities = [];
      const secondaryEntities = [];
      for (const entity of intent.entities) {
        // By default, entities type and alias are equal to their name
        let entityType = entity.name;
        let alias =
          entity.name.indexOf('@') === 0 ? entity.name.substr(1) : entity.name;

        // If we have a specific mapping for Dialogflow, then use it
        if (entity.mapping && entity.mapping.dialogflow) {
          if (entity.mapping.dialogflow.type) {
            entityType = entity.mapping.dialogflow.type;
          }
          if (entity.mapping.dialogflow.name) {
            alias = entity.mapping.dialogflow.name;
          }
        }

        if (entity.primary === true) {
          primaryEntities.push(`${entityType}:${alias}`);
        } else {
          secondaryEntities.push(`${entityType}:${alias}`);
        }

        // Entity can appear multiple times (at least twice)
        if (entity.multiple === true) {
          secondaryEntities.push(`${entityType}:${alias}`);
        }
      }
      // Generate permutations
      if (
        intent.settings.generate !== false &&
        (primaryEntities.length > 0 || secondaryEntities.length > 0)
      ) {
        const prefixes =
          typeof intent.prefixes === 'object'
            ? intent.prefixes[intent.languageCode]
            : [];

        const shouldPermute =
          typeof intent.settings.permute === 'undefined'
            ? true
            : intent.permute;
        const permutations = permuter.permute(
          primaryEntities,
          secondaryEntities,
          {
            prefixes,
            prefixesOnly: intent.prefixesOnly,
            permute: shouldPermute
          }
        );

        if (argv['dry-run'] === true) {
          console.log(
            'Permutations:',
            util.inspect(permutations, { maxArrayLength: null, depth: null })
          );
        }

        /*
        {
          text: part.text,
          entityType,
          alias,
          user_defined: true
        }
        text: sampleMatch.body, // eg. 'today'
        entityType: typeMatch.body, // eg. @datetime
        alias: typeMatch.body // eg. 'datetime'
        */

        // Split the permutations into an array
        for (const [i, permutation] of permutations.entries()) {
          const parts = [];
          const permsArray = permutation.split(' ');
          for (const perm of permsArray) {
            const splitPerm = perm.split(':');
            const entityName = splitPerm[0].substr(1);
            const entityAlias = splitPerm[1];
            const entity = globalConfig.entities
              .filter(ent => ent.name === entityName)
              .pop();

            if (!entity) {
              if (perm.startsWith('@')) {
                console.error(
                  `No config found for entity "${entityName}" at index ${i} ("${permutation}")`
                );
              } else {
                parts.push({
                  text: perm
                });
                parts.push({
                  text: ' '
                });
              }
            } else if (!entity.sample || !entity.sample[intent.languageCode]) {
              console.error(
                `No sample found for entity config "${entityName}" (lang: ${intent.languageCode})`
              );
            } else {
              let entityType;
              if (
                entity.settings &&
                entity.settings.dialogflow &&
                entity.settings.dialogflow.type
              ) {
                entityType = entity.settings.dialogflow.type;
              } else {
                entityType = `@${entity.name}`;
              }
              const sample = entity.sample[intent.languageCode];
              const sampleText = Array.isArray(sample)
                ? sample[Math.floor(Math.random() * sample.length)]
                : sample;
              parts.push({
                text: sampleText,
                entityType, // '@shop'
                alias: entityAlias || entity.name // 'shop'
              });
              parts.push({
                text: ' '
              });
            }
          }

          // Add permutations to the training phrases
          dialogflowPhrases.push({
            type: 'EXAMPLE',
            parts: parts.slice(0, parts.length - 1) // Remove last space (' ') from parts
          });
        }

        /*
        // Add permutations to the training phrases
        permutations.forEach(permutation => {
          dialogflowPhrases.push({
            type: 'TRAINING',
            parts: [
              {
                text: permutation
              }
            ]
          });
        });
        */
      }
    }

    // Check if there is too many training phrases for Dialogflow
    if (dialogflowPhrases.length > maxTrainingPhrases) {
      console.warn(
        `Dialogflow: Intent ${intent.name}@${intent.languageCode}, has more than ${maxTrainingPhrases} training phrases (count: ${dialogflowPhrases.length}), which might cause stability issues`
      );
    }

    // Add responses from intent config
    if (intent.responses) {
      intent.responses.forEach(resp => {
        responses.push(resp);
      });
    }

    // Create intent data object
    const newIntentData = {
      action: intent.name,
      trainingPhrases: dialogflowPhrases
    };
    if (responses && responses.length > 0) {
      newIntentData.messages = [{ text: { text: responses } }];
    }
    if (argv['dry-run'] === true) {
      debug(
        'Would have sent to Dialogflow: ',
        util.inspect(newIntentData, { showHidden: false, depth: null })
      );
      resolve();
    } else {
      apiDialogflowUpdateIntent(
        intent.settings.dialogflow.id,
        intent.languageCode,
        newIntentData
      )
        .then(() => {
          setTimeout(resolve, 4000);
        })
        .catch(reject);
    }
  });
}

async function trainIntent(intent, data) {
  return new Promise((resolve, reject) => {
    trainIntentDialogflow(intent, data)
      .then(resolve, reject)
      .catch(reject);
  });
}

function parseLine(intent, line) {
  const ret = {
    line,
    parts: []
  };

  let nextPart = line;
  while (nextPart !== undefined) {
    const currentPart = nextPart;
    nextPart = undefined;

    const sampleMatch = balanced('[', ']', currentPart);
    if (sampleMatch) {
      ret.parts.push({
        text: sampleMatch.pre
      });

      const typeMatch = balanced('(', ')', sampleMatch.post);
      if (typeMatch) {
        ret.parts.push({
          text: sampleMatch.body, // eg. 'today'
          entityType: typeMatch.body, // eg. @datetime
          alias: typeMatch.body // eg. 'datetime'
        });

        // Look for the next part
        if (typeMatch.post.length > 0) {
          nextPart = typeMatch.post;
        }
      }
    } else {
      ret.parts.push({
        text: currentPart
      });
    }
  }

  return ret;
}

async function processIntentFile(intent, filePath, opts) {
  opts = opts || {
    skipHeader: false
  };

  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) {
      console.warn('Intent input file not found:', filePath);
      resolve();
      return;
    }

    const parser = parse((err, data) => {
      if (err) {
        console.warn('Intent input file could not be parsed:', filePath);
        reject(err);
        return;
      }

      if (opts.skipHeader === true) {
        data = data.slice(1);
      }

      const phrases = [];
      const responses = [];

      data.forEach(line => {
        if (line[0] && line[0].length) {
          phrases.push(parseLine(intent, line[0]));
        }
        if (line[1] && line[1].length) {
          responses.push(line[1]);
        }
      });

      resolve({
        phrases,
        responses
      });
    });
    fs.createReadStream(filePath).pipe(parser);
  });
}

async function processEntityQuery(entity) {
  return new Promise((resolve, reject) => {
    const entries = [];

    sparqlTransformer(entity.query.body, {
      endpoint: entity.query.endpoint,
      context: entity.query.context || '',
      debug: argv.verbose || false
    })
      .then(results => {
        results.forEach(row => {
          let ref = null;
          if (
            typeof row.ref === 'object' &&
            typeof row.ref.value === 'string'
          ) {
            ref = row.ref.value;
          } else if (typeof row.ref === 'string') {
            ({ ref } = row);
          }

          if (ref) {
            const synonyms = [ref];
            if (Array.isArray(row.synonyms)) {
              row.synonyms.forEach(synonym => {
                if (
                  typeof synonym === 'object' &&
                  typeof synonym.value === 'string'
                ) {
                  synonyms.push(synonym.value);
                } else if (typeof synonym === 'string') {
                  synonyms.push(synonym);
                }
              });
            }
            entries.push({ reference: ref, synonyms });
          }
        });

        resolve({
          entries
        });
      })
      .catch(reject);
  });
}

async function processEntityFile(entity, opts) {
  opts = opts || {
    skipHeader: false
  };

  return new Promise((resolve, reject) => {
    const filePath = path.join(
      __dirname,
      'entities',
      `[${entity.name}]@${entity.languageCode}.csv`
    );

    if (!fs.existsSync(filePath)) {
      console.error('Entity input file not found:', filePath);
      reject();
      return;
    }

    const parser = parse((err, data) => {
      if (err) {
        console.error('Entity input file could not be parsed:', filePath);
        reject(err);
        return;
      }

      if (opts.skipHeader === true) {
        data = data.slice(1);
      }

      const entries = [];

      for (let i = 0; i < data.length; i += 1) {
        const line = data[i];
        if (line[0] && line[0].length) {
          let synonyms = [];
          if (line[1] && line[1].length) {
            synonyms = line[1]
              .split(',')
              .map(l => l.trim())
              .filter(l => l);
          }
          entries.push({ reference: line[0], synonyms });
        }
      }

      resolve({
        entries
      });
    });
    fs.createReadStream(filePath).pipe(parser);
  });
}

async function updateEntityDialogflow(entity, data) {
  const { entries } = data;
  const maxSynonymsPerEntry = 100;

  return new Promise((resolve, reject) => {
    // Dialogflow
    const dialogflowEntries = entries.map(entry => ({
      value: entry.reference,
      synonyms: entry.synonyms
    }));

    dialogflowEntries.forEach((entry, entryIndex) => {
      const synonymsLen = entry.synonyms.length;
      if (synonymsLen === 0) {
        console.warn(
          `Dialogflow: In entity ${entity.name}@${entity.languageCode}, reference "${entry.value}" has 0 synonyms and will be removed`
        );

        // Remove entry which doesn't contain any synonyms
        dialogflowEntries.splice(entryIndex, 1);
      } else if (synonymsLen > maxSynonymsPerEntry) {
        let { splitEntries } = globalConfig.options.dialogflow;
        if (typeof splitEntries !== 'boolean') {
          splitEntries = true;
        }
        console.warn(
          `Dialogflow: In entity ${entity.name}@${
            entity.languageCode
          }, reference "${
            entry.value
          }" has more than ${maxSynonymsPerEntry} synonyms (count: ${synonymsLen})${
            splitEntries === true
              ? ` and will be split into multiple references`
              : ``
          }`
        );

        // Remove entry which is too large
        dialogflowEntries.splice(entryIndex, 1);

        // Split the large entry into smaller entries
        const splitSynonyms = partitionArray(
          entry.synonyms,
          maxSynonymsPerEntry
        );
        splitSynonyms.forEach(syns => {
          dialogflowEntries.push({
            value: `${entry.value}`,
            synonyms: syns
          });
        });
      } else {
        // Normalize synonyms
        entry.synonyms = entry.synonyms.map(synonym =>
          synonym.normalize('NFD')
        );
      }
    });

    if (argv['dry-run'] === true) {
      resolve();
    } else {
      apiDialogflowUpdateEntity(
        entity.settings.dialogflow.id,
        entity.languageCode,
        {
          entities: dialogflowEntries
        }
      )
        .then(resolve)
        .catch(reject);
    }
  });
}

async function updateEntity(entity, data) {
  return new Promise((resolve, reject) => {
    updateEntityDialogflow(entity, data)
      .then(resolve, reject)
      .catch(reject);
  });
}

// ---

// Check if a list intents is passed with --intents
let intentsFilter = [];
if (Array.isArray(argv.intents)) {
  intentsFilter = argv.intents;
} else if (typeof argv.intents === 'string') {
  intentsFilter = argv.intents.split(',');
}

// Create a list of intents with one intent per language code
const intentsList = [];
globalConfig.intents
  .filter(
    intent => argv.intents === true || intentsFilter.includes(intent.name)
  )
  .forEach(intent => {
    // Initialize intent entities array if needed
    if (typeof intent.entities === 'undefined') {
      intent.entities = [];
    }

    if (Array.isArray(intent.languageCode)) {
      intent.languageCode.forEach(lang => {
        const langIntent = JSON.parse(JSON.stringify(intent));
        langIntent.languageCode = lang;
        intentsList.push(langIntent);
      });
    } else {
      intentsList.push(intent);
    }
  });

// Iterate through each intent and process it
intentsList.reduce(
  (chain, promise) =>
    chain
      .then(() => promise)
      .then(async intent => {
        let data;
        try {
          const csvPath = path.join(
            __dirname,
            'intents',
            `[${intent.name}]@${intent.languageCode}.csv`
          );
          if (fs.existsSync(csvPath)) {
            data = await processIntentFile(intent, csvPath, {
              skipHeader: true
            });
          }
        } catch (e) {
          throw e;
        }
        return trainIntent(intent, data);
      })
      .catch(error => {
        throw error;
      }),
  Promise.resolve()
);

// Check if a list entities is passed with --entities
let entitiesFilter = [];
if (Array.isArray(argv.entities)) {
  entitiesFilter = argv.entities;
} else if (typeof argv.entities === 'string') {
  entitiesFilter = argv.entities.split(',');
}

// Create a list of entities with one entity per language code
const entitiesList = [];
globalConfig.entities
  .filter(
    entity => argv.entities === true || entitiesFilter.includes(entity.name)
  )
  .forEach(entity => {
    if (Array.isArray(entity.languageCode)) {
      entity.languageCode.forEach(lang => {
        const langEntity = JSON.parse(JSON.stringify(entity));
        langEntity.languageCode = lang;
        entitiesList.push(langEntity);
      });
    } else {
      entitiesList.push(entity);
    }
  });

// Iterate through each entity and process it
entitiesList.reduce(
  (chain, promise) =>
    chain
      .then(() => promise)
      .then(async entity => {
        let data;

        // Check if the entity has a SPARQL query
        if (entity.query) {
          data = await processEntityQuery(entity);
        } else {
          // Otherwise, process CSV file
          data = await processEntityFile(entity, {
            skipHeader: true
          });
        }

        // Send new entity data to the NLUs
        return updateEntity(entity, data);
      })
      .catch(error => {
        throw error;
      }),
  Promise.resolve()
);
