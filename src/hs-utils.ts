export const isMercenaries = (gameMode: string): boolean => {
	return [
		'mercenaries-pve',
		'mercenaries-pvp',
		'mercenaries-pve-coop',
		'mercenaries-ai-vs-ai',
		'mercenaries-friendly',
	].includes(gameMode);
};

export const normalizeMercCardId = (cardId: string): string => {
	if (!cardId?.length) {
		return null;
	}
	let skinMatch = cardId.match(/.*_(\d\d)([ab]?)$/);
	if (skinMatch) {
		return cardId.replace(/(.*)(_\d\d)([ab]?)$/, '$1_01$3');
	}
	// Sometimes it is 01, sometimes 001
	skinMatch = cardId.match(/.*_(\d\d\d)([ab]?)$/);
	if (skinMatch) {
		return cardId.replace(/(.*)(_\d\d\d)([ab]?)$/, '$1_001$3');
	}
	return cardId;
};

export const getCardLevel = (cardId: string): number => {
	if (!cardId) {
		return 0;
	}

	// Generic handling of mercenaries skins or levelling
	const skinMatch = cardId.match(/.*_(\d\d)$/);
	if (skinMatch) {
		return parseInt(skinMatch[1]);
	}
	return 0;
};

export const getDefaultHeroDbfIdForClass = (playerClass: string): number => {
	switch (playerClass?.toLowerCase()) {
		case 'demonhunter':
			return 56550;
		case 'druid':
			return 274;
		case 'hunter':
			return 31;
		case 'mage':
			return 637;
		case 'paladin':
			return 671;
		case 'priest':
			return 813;
		case 'rogue':
			return 930;
		case 'shaman':
			return 1066;
		case 'warlock':
			return 893;
		case 'warrior':
			return 7;
		default:
			console.warn('Could not normalize hero card id', playerClass);
			return 7;
	}
};
