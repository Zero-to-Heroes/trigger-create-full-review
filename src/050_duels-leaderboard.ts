import { ReplayInfo } from './create-full-review';

export const updateDuelsLeaderboard = async (replayInfo: ReplayInfo): Promise<void> => {
	return;
	// const review = replayInfo.reviewMessage;
	// // logger.debug('handling review', review);
	// const playerRank = review.playerRank ? parseInt(review.playerRank) : null;
	// if (!playerRank) {
	// 	return;
	// }

	// const playerName = review.playerName;
	// if (!playerName && review.appVersion === '9.3.5') {
	// 	// logger.debug('ignoring bogus version');
	// 	return;
	// }

	// const query = `
	// 	SELECT id FROM duels_leaderboard
	// 	WHERE playerName = ${SqlString.escape(review.playerName)} AND gameMode = ${SqlString.escape(review.gameMode)}`;
	// // logger.debug('running query', query);
	// const mysql = await getConnection();
	// const results: any[] = await mysql.query(query);

	// if (results?.length) {
	// 	const id = results[0].id;
	// 	const updateQuery = `
	// 		UPDATE duels_leaderboard
	// 		SET
	// 			rating = ${SqlString.escape(review.playerRank)},
	// 			lastUpdateDate = ${SqlString.escape(review.creationDate)},
	// 			region = ${SqlString.escape(review.region)}
	// 		WHERE id = ${SqlString.escape(id)}
	// 	`;
	// 	// logger.debug('running update query', updateQuery);
	// 	const updateResult = await mysql.query(updateQuery);
	// 	// logger.debug('update result', updateResult);
	// } else {
	// 	const insertQuery = `
	// 		INSERT IGNORE INTO duels_leaderboard (playerName, gameMode, rating, lastUpdateDate, region)
	// 		VALUES (
	// 			${SqlString.escape(playerName)},
	// 			${SqlString.escape(review.gameMode)},
	// 			${SqlString.escape(playerRank)},
	// 			${SqlString.escape(review.creationDate)},
	// 			${SqlString.escape(review.region)}
	// 		)
	// 	`;
	// 	// logger.debug('running insert query', insertQuery);
	// 	const insertResult = await mysql.query(insertQuery);
	// 	// logger.debug('insert result', insertResult);
	// }
};
