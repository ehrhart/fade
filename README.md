# FADE

FADE (Filling Automatically Dialog Events) is a tool that extracts information from knowledge graphs, apply permutation rules and build dictionary of entities that must be recognized by a NLU engine.

## How to run

The project comes with a sample configuration file (config/sample.json) that defines the list of intents, entities and permutations rules. It is also used to configure the parameters specific to each NLU (project identifiers, credentials, ...)

Some sample intents and entities are also defined (intents/test.csv and entities/fruits.csv).

```
cd /path/to/fade

node . config/sample.json
```

## Parameters
* --no-entities
  * Disable entities processing.
* --no-intents
  * Disable intents processing.
* --intents=intent1,intent2,intent3
  * Process some intents by their names (separated by commas).
* --entities=entity1,entity2,entity3
  * Process some entities by their names (separated by commas).
* --dry-run
  * Obtain a summary of the results, without actually sending them to the NLUs.

## Debug
Add the environment variable `DEBUG=fade:*` to enable the trace output, used for debugging purpose.

## Configuration
The root of the configuration file has 3 main properties, as described below.

Full examples of configuration files can be found in the config/ folder.

### Options
Project options.

Example:
```json
{
  "options": {
    "dialogflow": {
      "projectId": "test-12345"
    }
  }
}
```

### Intents
|PROPERTY|INPUT|NOTES|
|---|---|---|
|`name`|string|Intent name.|
|`languageCode`|array, string|Intent language(s) (ISO 639-1).|
|`settings`|object|NLU specific settings.|
|`entities`|object|List of entities used for this intent. At least one entity requires having `primary` set to **true** in order to generate permutations around that entity.|
|`query`|object|SPARQL query (currently only supports [sparql-transformer](https://github.com/D2KLab/sparql-transformer) template). Reference value must be named `ref`.

Example:
```json
{
  "intents": [
    {
      "name": "test",
      "languageCode": ["en", "fr"],
      "settings": {
        "dialogflow": {
          "id": "185a4cc9-ba13-433b-8710-23b353194d14",
          "trainingMode": "TEMPLATE"
        }
      },
      "entities": [
        {
          "name": "@fruit",
          "primary": true
        }
      ]
    }
  ]
}
```

### Entities
|PROPERTY|INPUT|NOTES|
|---|---|---|
|`name`|string|Entity name.|
|`languageCode`|array, string|Entity language(s) (ISO 639-1).|
|`settings`|object|NLU specific settings.|
|`sample`|object|Value sample for each language.|
|`query`|object|SPARQL query (currently only supports [sparql-transformer](https://github.com/D2KLab/sparql-transformer) template). Reference value must be named `ref`.

Example:
```json
{
  "entities": [
    {
      "name": "city",
      "languageCode": ["en", "fr"],
      "settings": {
        "dialogflow": {
          "id": "10a1c29f-a92a-57cc-c4c5-5ce1cafa126c"
        }
      },
      "sample": {
        "en": "Nice",
        "fr": "Nice"
      },
      "query": {
        "endpoint": "https://kb.city-moove.fr/sparql",
        "body": {
          "proto": {
            "id": "?id",
            "ref": "$foaf:name$required$sample"
          },
          "$where": [
            "GRAPH <http://3cixty.com/cotedazur/metadata> { ?s foaf:name ?name }"
          ],
          "$limit": 200
        }
      }
    }
  ]
}
```
