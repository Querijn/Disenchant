export interface LolLootPlayerLoot {
	asset: string,
	count: number,
	disenchantLootName: string,
	disenchantValue: number,
	displayCategories: string,
	expiryTime: number,
	isNew: true,
	isRental: true,
	itemDesc: string,
	itemStatus: "NONE",
	localizedDescription: string,
	localizedName: string,
	localizedRecipeSubtitle: string,
	localizedRecipeTitle: string,
	lootId: string,
	lootName: string,
	parentItemStatus: "NONE",
	parentStoreItemId: number,
	rarity: string,
	redeemableStatus: "UNKNOWN",
	refId: string,
	rentalGames: number,
	rentalSeconds: number,
	shadowPath: string,
	splashPath: string,
	storeItemId: number,
	tags: string,
	tilePath: string,
	type: string,
	upgradeEssenceName: string,
	upgradeEssenceValue: number,
	upgradeLootName: string,
	value: number
}

export interface ChampionMastery {
	championId: number;
	championLevel: number;
	championPoints: number;
	championPointsSinceLastLevel: number;
	championPointsUntilNextLevel: number;
	chestGranted: boolean;
	formattedChampionPoints: string;
	formattedMasteryGoal: string;
	highestGrade: string;
	lastPlayTime: number;
	playerId: number;
	tokensEarned: number;
}