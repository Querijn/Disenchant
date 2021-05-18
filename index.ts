const LCUConnector = require('lcu-connector');
const https = require("https");
const readline = require('readline');
import fetch from 'node-fetch';
import { ChampionMastery, LolLootPlayerLoot } from './types/lcu';

const connector = new LCUConnector();
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

interface LCUConnectorResult { port: number; username: string; password: string; };
let championByIdCache: {[language: string]: {[key: number]: DDragonChampion.Champion }} = {};
let championJson: {[language: string]: DDragonChampion.JSON } = {};
let authToken = 'UNAUTHORIZED';
let data: LCUConnectorResult;

function ask(question: string, defaultAnswer?: string) {
	return new Promise<string>((r) => {
		if (defaultAnswer != null)
			question = `${question} (Default = "${defaultAnswer}")`;
		rl.question(question + " ", function (answer: string) {
			if (answer.length === 0 && defaultAnswer != null)
				r(defaultAnswer);
			else
				r(answer);
		});
	});
}

async function askYesNo(question: string, defaultAnswer?: "yes" | "no") {
	if (defaultAnswer != null)
		question = `${question} (Default = ${defaultAnswer ? "yes" : "no"})`;
	while (true) {
		const answer = (await ask(question)).toLowerCase();
		if (answer.length === 0 && defaultAnswer != null)
			return defaultAnswer;
		if (answer == "yes" || answer == "y")
			return true;
		if (answer == "no" || answer == "n")
			return false;
	}
}

async function askNumber(question: string, defaultAnswer?: number) {
	if (defaultAnswer != null)
		question = `${question} (Default = ${defaultAnswer})`;
	while (true) {
		const answer = (await ask(question)).toLowerCase();
		if (answer.length === 0 && typeof defaultAnswer !== 'undefined')
			return defaultAnswer;

		const number = parseInt(answer, 10);
		if (!isNaN(number)) {
			return number;
		}
	}
}

async function getLatestChampionDDragon(language: string) {

	if (championJson[language])
		return championJson[language];

	let response;
	let versionIndex = 0;
	do { // I loop over versions because 9.22.1 is broken
		const version = (await fetch("http://ddragon.leagueoflegends.com/api/versions.json").then(async (r) => await r.json()))[versionIndex++];

		response = await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/${language}/champion.json`);
	}
	while (!response.ok)

	championJson[language] = await response.json();
	return championJson[language];
}

async function getChampionByKey(key: number, language: string) {

	// Setup cache
	if (!championByIdCache[language]) {
		let json = await getLatestChampionDDragon(language);

		championByIdCache[language] = {};
		for (var championName in json.data) {
			if (!json.data.hasOwnProperty(championName))
				continue;

			const champInfo = json.data[championName];
			championByIdCache[language][+champInfo.key] = champInfo;
		}
	}

	return championByIdCache[language][key];
}

async function lcu(path: string, method: "GET"|"POST" = "GET", body?: string) {

	const response = await fetch(`https://127.0.0.1:${data.port}${path}`, {
		method, body,
		headers: {
			Authorization: authToken,
			Accept: "application/json"
		}
	});

	return await response.json();
}

connector.on('connect', async (c: LCUConnectorResult) => {
	data = c;
	authToken = `Basic ${(Buffer.from(`${data.username}:${data.password}`)).toString('base64')}`;

	const loot: LolLootPlayerLoot[] = await lcu("/lol-loot/v1/player-loot-map");
	const capsules = Object.values(loot).find((x: any) => x.storeItemId === 128);
	const champs = Object.values(loot).filter((x: any) => x.type === "CHAMPION_RENTAL");

	const me = await lcu("/lol-summoner/v1/current-summoner");
	const mastery = <ChampionMastery[]>await lcu(`/lol-collections/v1/inventories/${me.summonerId}/champion-mastery`);
	const owned = [... (await lcu(`/lol-champions/v1/inventories/${me.summonerId}/champions`))].filter(c => c.ownership.owned);

	let disenchantValue = 0;
	let count = 0;
	const promises = [];

	if (capsules && capsules.count > 0 && await askYesNo(`Should we open your ${capsules.count} champion capsule${capsules.count != 1 ? "s" : ""}?`)) {
		const result = await lcu("/lol-loot/v1/recipes/CHEST_128_OPEN/craft?repeat=" + capsules.count, "POST", JSON.stringify([capsules.lootId]));
		console.log("Champion capsules opened.");
	}

	console.log("You can use champion tokens to improve your mastery level. You might want one for level 6 and one for 7.");	
	const noChampKeepCount = await askNumber("How many Champion Tokens do you want to keep when you don't have the champion?");
	const lowLevelKeepCount = await askNumber("How many Champion Tokens do you want to keep when you're between level 0 and 4 on the champion?");
	const level5KeepCount = await askNumber("How many Champion Tokens do you want to keep when you're between level 5 on the champion?");
	const level6KeepCount = await askNumber("How many Champion Tokens do you want to keep when you're between level 6 on the champion?");

	const actions = [];
	for (const champ of champs) {
		const champId = +champ.lootId.split("_")[2];
		const championData = await getChampionByKey(champId, "en_US");
		let entry = mastery.find(x => x.championId === champId) || { championLevel: 0 };

		const hasChampion = owned.find(c => c.id == champId) != null;
		if (hasChampion) {
			if (entry.championLevel == 6)
				champ.count -= level6KeepCount;
			else if (entry.championLevel == 5)
				champ.count -= level5KeepCount;
			else if (entry.championLevel < 5)
				champ.count -= lowLevelKeepCount;
		}
		else if (hasChampion == false) {
			champ.count -= noChampKeepCount;
		}

		if (champ.count <= 0)
			continue;

		disenchantValue += champ.disenchantValue * champ.count;
		count += champ.count;

		actions.push({ ...champ, name: championData.name });
	}

	if (count == 0) {
		console.log(`It seems we don't have any champions you can disenchant.`);
		connector.stop();
		process.exit(0);
		return;
	}

	const shouldDisenchant = await askYesNo(`Would you like to disenchant ${count} champion shards for ${disenchantValue} BE? (${actions.map(a => a.name + " x" + a.count).join(", ")})`)
	if (!shouldDisenchant) {
		console.log(`Done. No champions were disenchanted.`);
		connector.stop();
		process.exit(0);
		return;
	}

	for (let champ of actions)
	 	promises.push(lcu("/lol-loot/v1/recipes/CHAMPION_RENTAL_disenchant/craft?repeat=" + champ.count, "POST", [champ.lootId]));
	await Promise.all(promises);

	console.log(`Done. Disenchanted ${count} champion shards for ${disenchantValue} BE.`);
	connector.stop();
	process.exit(0);
});

console.log("Trying to find League of Legends.. If you haven't started the client yet, please do so, I need it to get this to work.");
connector.start();