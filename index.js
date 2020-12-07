const LCUConnector = require('lcu-connector');
const https = require("https");
const readline = require('readline');
const fetch = require('node-fetch');

const connector = new LCUConnector();
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

let championByIdCache = {};
let championJson = {};
let authToken = 'UNAUTHORIZED';
let data;

function ask(question, defaultAnswer = undefined) {
	return new Promise((r) => {
		if (defaultAnswer != null)
			question = `${question} (Default = "${defaultAnswer}")`;
		rl.question(question + " ", function (answer) {
			if (answer.length === 0 && defaultAnswer != null)
				r(defaultAnswer);
			else
				r(answer);
		});
	});
}
async function askYesNo(question, defaultAnswer = undefined) {
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
async function getLatestChampionDDragon(language) {

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
async function getChampionByKey(key, language) {

	// Setup cache
	if (!championByIdCache[language]) {
		let json = await getLatestChampionDDragon(language);

		championByIdCache[language] = {};
		for (var championName in json.data) {
			if (!json.data.hasOwnProperty(championName))
				continue;

			const champInfo = json.data[championName];
			championByIdCache[language][champInfo.key] = champInfo;
		}
	}

	return championByIdCache[language][key];
}

function lcu(path, method = "GET", body = undefined) {
	return new Promise(resolve => {
		const req = https.request({
			host: "127.0.0.1",
			port: data.port,
			path,
			method,
			headers: {
				Authorization: authToken,
				"Content-Type": "application/json"
			}
		}, res => {
			let contents = "";
			res.setEncoding("utf8");
			res.on("data", chunk => contents += chunk);

			res.on("end", () => {
				resolve(JSON.parse(contents));
			});
		});

		if (body) req.write(JSON.stringify(body));

		req.end();
	});
}

connector.on('connect', async (c) => {
	data = c;
	authToken = `Basic ${(Buffer.from(`${data.username}:${data.password}`)).toString('base64')}`;

	const loot = await lcu("/lol-loot/v1/player-loot-map");
	const capsules = Object.values(loot).find(x => x.storeItemId === 128);
	const champs = Object.values(loot).filter(x => x.type === "CHAMPION_RENTAL");

	const me = await lcu("/lol-summoner/v1/current-summoner");
	const mastery = await lcu(`/lol-collections/v1/inventories/${me.summonerId}/champion-mastery`);
	const owned = [... (await lcu(`/lol-champions/v1/inventories/${me.summonerId}/champions`))].filter(c => c.ownership.owned);

	let disenchantValue = 0;
	let count = 0;
	const promises = [];

	if (capsules && capsules.count > 0 && await askYesNo(`Should we open your ${capsules.count} champion capsule${capsules.count != 1 ? "s" : ""}?`)) {
		const result = await lcu("/lol-loot/v1/recipes/CHEST_128_OPEN/craft?repeat=" + capsules.count, "POST", [capsules.lootId]);
		console.log("Champion capsules opened.");
	}

	console.log("You can use champion tokens to improve your mastery level. You might want one for level 6 and one for 7.");
	const disenchantLv5 = await askYesNo("Should we disenchant champion shards when you're mastery level 5 on the champion?");
	const keepTwoShards = disenchantLv5 == false ? await askYesNo("Do you want to keep two shards in this case? You would have one for level 6 as well.") : false;
	const disenchantLv6 = await askYesNo("Should we disenchant champion shards when you're mastery level 6 on the champion?");
	const disenchantlowLv = await askYesNo("Should we keep two shards when you're low mastery on the champion?");
	const disenchantUnowned = await askYesNo("Should we disenchant champion shards of champs you don't own?");

	const actions = [];
	for (const champ of champs) {
		const champId = +champ.lootId.split("_")[2];
		const championData = await getChampionByKey(champId, "en_US");
		const entry = mastery.find(x => x.championId === champId);

		if (entry) {
			
			if (entry.championLevel < 5 && disenchantlowLv == true)
				champ.count -= 2;
			
			if (entry.championLevel == 5 && disenchantLv5 == false)
				champ.count -= keepTwoShards ? 2 : 1;

			if (entry && entry.championLevel == 6 && disenchantLv6 == false)
				champ.count--;
		}
		
		const hasChampion = owned.find(c => c.id == champId) != null;
		if (disenchantUnowned == false && hasChampion == false)
			champ.count--;
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