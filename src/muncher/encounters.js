// Main module class
import { checkMonsterCompendium } from "./importMonster.js";
import { munchNote, download, getPatreonTiers } from "./utils.js";
import logger from "../logger.js";
import { getCobalt } from "../lib/Secrets.js";
import { getAvailableCampaigns } from "../lib/Settings.js";

// eslint-disable-next-line no-unused-vars
import { getCharacterImportSettings, getMuncherSettings, updateActorSettings, updateMuncherSettings } from "./settings.js";

const DIFFICULTY_LEVELS = [
  { id: null, name: "No challenge", color: "grey" },
  { id: 1, name: "Easy", color: "green" },
  { id: 2, name: "Medium", color: "brown" },
  { id: 3, name: "Hard", color: "orange" },
  { id: 4, name: "Deadly", color: "red" },
];


async function getEncounterData() {
  const cobaltCookie = getCobalt();
  const betaKey = game.settings.get("ddb-importer", "beta-key");
  const parsingApi = game.settings.get("ddb-importer", "api-endpoint");
  const debugJson = game.settings.get("ddb-importer", "debug-json");

  const body = {
    cobalt: cobaltCookie,
    betaKey: betaKey,
  };

  return new Promise((resolve, reject) => {
    fetch(`${parsingApi}/proxy/encounters`, {
      method: "POST",
      mode: "cors",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body), // body data type must match "Content-Type" header
    })
      .then((response) => response.json())
      .then((data) => {
        if (!data.success) {
          munchNote(`API Failure: ${data.message}`);
          reject(data.message);
        }
        if (debugJson) {
          download(JSON.stringify(data), `encounters-raw.json`, "application/json");
        }
        return data;
      })
      .then((data) => {
        munchNote(`Retrieved ${data.data.length} encounters, starting parse...`, true, false);
        logger.info(`Retrieved ${data.data.length} encounters`);
        resolve(data.data);
      })
      .catch((error) => reject(error));
  });
}

export async function parseEncounters() {
  const encounters = await getEncounterData();
  logger.debug("Fetched encounters", encounters);
  munchNote(`Fetched Available DDB Encounters`);
  CONFIG.DDBI.ENCOUNTERS = encounters;
  munchNote("");
  return CONFIG.DDBI.ENCOUNTERS;
}


async function filterEncounters(campaignId) {
  const campaigns = await getAvailableCampaigns();
  const campaignIds = campaigns.map((c) => c.id);
  const allEncounters = CONFIG.DDBI.ENCOUNTERS
     ? CONFIG.DDBI.ENCOUNTERS
     : await parseEncounters();

  logger.debug(`${allEncounters.length} encounters`, allEncounters);
  logger.debug("CampaignIds", campaignIds);
  if (!campaignId || campaignId === "" || !campaignIds.includes(parseInt(campaignId))) return allEncounters;
  logger.debug(`CampaignId to find ${campaignId}`);
  const filteredEncounters = allEncounters.filter((encounter) => encounter.campaign.id == campaignId);
  logger.debug(`${filteredEncounters.length} filtered encounters`, filteredEncounters);
  return filteredEncounters;

}


export class DDBEncounterMunch extends Application {
  constructor(options = {}) {
    super(options);
    this.encounter = {};
  }

  static get defaultOptions() {
    const options = super.defaultOptions;
    options.baseApplication = "DDBEncounterMuncher";
    options.id = "ddb-importer-encounters";
    options.template = "modules/ddb-importer/handlebars/encounters.hbs";
    options.resizable = false;
    options.height = "auto";
    options.width = 800;
    options.title = "MrPrimate's DDB Encounter Muncher";
    options.classes = ["ddb-muncher", "sheet"];
    options.tabs = [{ navSelector: ".tabs", contentSelector: "div", initial: "settings" }];
    return options;
  }

  async parseEncounter(id) {
    logger.debug(`Looking for Encounter "${id}"`);
    if (!CONFIG.DDBI.ENCOUNTERS) return this.encounter;
    const monsterPack = await checkMonsterCompendium();

    await monsterPack.getIndex({ fields: ["name", "flags.ddbimporter.id"] });

    // console.warn(CONFIG.DDBI.ENCOUNTERS);
    const encounter = CONFIG.DDBI.ENCOUNTERS.find((e) => e.id == id.trim());
    // console.warn(encounter);

    // if (!encounter) return this.encounter;

    let goodMonsterIds = [];
    let missingMonsterIds = [];
    logger.debug("Parsing encounter", encounter);
    encounter.monsters.forEach((monster) => {
      const id = monster.id;
      const monsterInPack = monsterPack.index.find((f) => f.flags.ddbimporter.id == id);
      if (monsterInPack) {
        goodMonsterIds.push({ ddbId: id, name: monsterInPack.name, id: monsterInPack.id, quantity: monster.quantity });
      } else {
        missingMonsterIds.push({ ddbId: id, quantity: monster.quantity });
      }
    });

    let goodCharacterData = [];
    let missingCharacterData = [];
    encounter.players
    .filter((character) => !character.hidden)
    .forEach((character) => {
      const characterInPack = game.actors.find((actor) => actor.data.flags?.ddbimporter?.dndbeyond?.characterId && actor.data.flags.ddbimporter.dndbeyond.characterId == character.id);
      if (characterInPack) {
        goodCharacterData.push({ id: characterInPack.id, name: characterInPack.name, ddbId: character.id });
      } else {
        missingCharacterData.push({ ddbId: character.id, name: character.name });
      }
    });

    const difficulty = DIFFICULTY_LEVELS.find((level) => level.id == encounter.difficulty);

    this.encounter = {
      name: encounter.name,
      difficulty,
      description: encounter.description,
      rewards: encounter.rewards,
      summary: encounter.flavorText,
      campaign: encounter.campaign,
      goodMonsterIds,
      missingMonsterIds,
      goodCharacterData,
      missingCharacterData,
      missingMonsters: missingMonsterIds.length !== 0,
      missingCharacters: missingCharacterData.length !== 0,
    };

    return this.encounter;

  }

  resetEncounterLabels(html) {
    const nameHtml = html.find("#ddb-encounter-name");
    const summaryHtml = html.find("#ddb-encounter-summary");
    const charactersHtml = html.find("#ddb-encounter-characters");
    const monstersHtml = html.find("#ddb-encounter-monsters");
    const difficultyHtml = html.find("#ddb-encounter-difficulty");
    const rewardsHtml = html.find("#ddb-encounter-rewards");

    nameHtml[0].innerHTML = `<p id="ddb-encounter-name"><i class='fas fa-question'></i> <b>Encounter:</b></p>`;
    summaryHtml[0].innerHTML = `<p id="ddb-encounter-summary"><i class='fas fa-question'></i> <b>Summary:</b></p>`;
    charactersHtml[0].innerHTML = `<p id="ddb-encounter-characters"><i class='fas fa-question'></i> <b>Characters:</b></p>`;
    monstersHtml[0].innerHTML = `<p id="ddb-encounter-monsters"><i class='fas fa-question'></i> <b>Monsters:</b></p>`;
    difficultyHtml[0].innerHTML = `<p id="ddb-encounter-difficulty"><i class='fas fa-question'></i> <b>Difficulty:</b></p>`;
    rewardsHtml[0].innerHTML = `<p id="ddb-encounter-rewards"><i class='fas fa-question'></i> <b>Rewards:</b></p>`;

    $('#ddb-importer-encounters').css("height", "auto");
    $('#encounter-button').prop("disabled", true);
    this.encounter = {};
  }

  activateListeners(html) {
    super.activateListeners(html);

    // filter campaigns
    html.find("#encounter-campaign-select").on("change", async () => {
      const campaignSelection = html.find("#encounter-campaign-select");
      // get selected campaign from html selection
      const campaignId = campaignSelection[0].selectedOptions[0]
        ? campaignSelection[0].selectedOptions[0].value
        : undefined;
      const encounters = await filterEncounters(campaignId);
      const campaignSelected = campaignId && campaignId !== "";
      let encounterList = `<option value="">Select encounter:</option>`;
      encounters.forEach((encounter) => {
        encounterList += `<option value="${encounter.id}">${encounter.name}${campaignSelected ? "" : ` (${encounter.campaign.name})`}</option>\n`;
      });
      const list = html.find("#encounter-select");
      list[0].innerHTML = encounterList;
      this.resetEncounterLabels(html);
    });

    // encounter change
    html.find('#encounter-select').on("change", async () => {
      this.resetEncounterLabels(html);
      const encounterSelection = html.find("#encounter-select");
      const encounterId = encounterSelection[0].selectedOptions[0]
        ? encounterSelection[0].selectedOptions[0].value
        : undefined;

      const encounter = await this.parseEncounter(encounterId);
      // console.warn(encounter);

      const nameHtml = html.find("#ddb-encounter-name");
      const summaryHtml = html.find("#ddb-encounter-summary");
      const charactersHtml = html.find("#ddb-encounter-characters");
      const monstersHtml = html.find("#ddb-encounter-monsters");
      const difficultyHtml = html.find("#ddb-encounter-difficulty");
      const rewardsHtml = html.find("#ddb-encounter-rewards");

      const missingCharacters = encounter.missingCharacters ? `fa-times-circle' style='color: red` : `fa-check-circle' style='color: green`;
      const missingMonsters = encounter.missingMonsters ? `fa-times-circle' style='color: red` : `fa-check-circle' style='color: green`;

      const goodCharacters = encounter.goodCharacterData.map((character) => `${character.name}`).join(", ");
      const goodMonsters = encounter.goodMonsterIds.map((monster) => `${monster.name}`).join(", ");
      const neededCharactersHTML = encounter.missingCharacters
        ? ` <span style="color: red"> Missing ${encounter.missingCharacterData.length}: ${encounter.missingCharacterData.map((character) => character.name).join(", ")}</span>`
        : "";
      const neededMonstersHTML = encounter.missingMonsters
        ? ` <span style="color: red"> Missing ${encounter.missingMonsterIds.length}: ${encounter.missingMonsterIds.map((monster) => monster.id).join(", ")}</span>`
        : "";

      nameHtml[0].innerHTML = `<i class='fas fa-check-circle' style='color: green'></i> <b>Encounter:</b> ${encounter.name}`;
      if (encounter.summary && encounter.summary.trim() !== "") summaryHtml[0].innerHTML = `<i class='fas fa-check-circle' style='color: green'></i> <b>Summary:</b> ${encounter.summary}`;
      if (encounter.goodCharacterData.length > 0 || encounter.missingCharacterData.length > 0) {
        charactersHtml[0].innerHTML = `<i class='fas ${missingCharacters}'></i> <b>Characters:</b> ${goodCharacters}${neededCharactersHTML}`;
      }
      if (encounter.goodMonsterIds.length > 0 || encounter.missingMonsterIds.length > 0) {
        monstersHtml[0].innerHTML = `<i class='fas ${missingMonsters}'></i> <b>Monsters:</b> ${goodMonsters}${neededMonstersHTML}`;
      }
      difficultyHtml[0].innerHTML = `<i class='fas fa-check-circle' style='color: green'></i> <b>Difficulty:</b> <span style="color: ${encounter.difficulty.color}">${encounter.difficulty.name}</span>`;
      if (encounter.rewards && encounter.rewards.trim() !== "") rewardsHtml[0].innerHTML = `<i class='fas fa-check-circle' style='color: green'></i> <b>Rewards:</b> ${encounter.rewards}`;

      $('#ddb-importer-encounters').css("height", "auto");
      $('#encounter-button').prop("disabled", false);
    });

    // import encounter
    html.find("#encounter-button").click(async (event) => {
      event.preventDefault();
      // to do:
      // create a new scene
      // create a folder for scene actors
      // import missing monsters?
      // import missing characters?
      // move monsters to actors folder
      // adjust monsters hp?
      // add monsters to scene
      // add characters to scene
      // add journal entry with details about players, monsters, description and treasure
      // handle the removal and addition of:
      // - homebrew settings (might not need this?)
      // - source filter (might not need this?)
      // - extra import?
      // - attempt to find magic items and add them to the world?

    });

  }

  // eslint-disable-next-line class-methods-use-this
  async getData() {
    const tier = game.settings.get("ddb-importer", "patreon-tier");
    const tiers = getPatreonTiers(tier);
    const availableCampaigns = await getAvailableCampaigns();
    const availableEncounters = await filterEncounters();

    const characterSettings = getCharacterImportSettings();
    const muncherSettings = getMuncherSettings(false);

    const importSettings = mergeObject(characterSettings, muncherSettings);

    const encounterConfig = [
      {
        name: "create-scene",
        isChecked: true,
        description: "Create a scene to use, and add available characters and NPC's?",
      },
      {
        name: "missing-characters",
        isChecked: true,
        description: "Import missing characters?",
      },
      {
        name: "missing-monsters",
        isChecked: true,
        description: "Import missing monsters?",
      },
      {
        name: "create-journal",
        isChecked: true,
        description: "Create encounter journal entry?",
      },
    ];
    // TO DO: add game settings and save and load

    const encounterSettings = {
      tiers,
      availableCampaigns,
      availableEncounters,
      encounterConfig,
    };

    const data = mergeObject(importSettings, encounterSettings);
    logger.debug("Encounter muncher form data", data);

    return data;
  }
}
