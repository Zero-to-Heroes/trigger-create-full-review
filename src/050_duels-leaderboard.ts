import { ReplayInfo } from './create-full-review';
import SqlString from 'sqlstring';
import { getConnection } from './services/rds';

export const updateDuelsLeaderboard = async (replayInfo: ReplayInfo): Promise<void> => {
	const review = replayInfo.reviewMessage;
	console.log('handling review', review);
	const playerRank = review.playerRank ? parseInt(review.playerRank) : null;
	if (!playerRank) {
		return;
	}

	const playerName = review.playerName;
	if (!playerName && review.appVersion === '9.3.5') {
		console.log('ignoring bogus version');
		return;
	}

	const query = `
		SELECT id FROM duels_leaderboard 
		WHERE playerName = ${SqlString.escape(review.playerName)} AND gameMode = ${SqlString.escape(review.gameMode)}`;
	console.log('running query', query);
	const mysql = await getConnection();
	const results: any[] = await mysql.query(query);

	if (!!results?.length) {
		const id = results[0].id;
		const updateQuery = `
			UPDATE duels_leaderboard
			SET 
				rating = ${SqlString.escape(review.playerRank)},
				lastUpdateDate = ${SqlString.escape(review.creationDate)},
				region = ${SqlString.escape(review.region)}
			WHERE id = ${SqlString.escape(id)}
		`;
		console.log('running update query', updateQuery);
		const updateResult = await mysql.query(updateQuery);
		console.log('update result', updateResult);
	} else {
		const insertQuery = `
			INSERT INTO duels_leaderboard (playerName, gameMode, rating, lastUpdateDate, region)
			VALUES (
				${SqlString.escape(playerName)}, 
				${SqlString.escape(review.gameMode)}, 
				${SqlString.escape(playerRank)}, 
				${SqlString.escape(review.creationDate)},
				${SqlString.escape(review.region)}
			)
		`;
		console.log('running insert query', insertQuery);
		const insertResult = await mysql.query(insertQuery);
		console.log('insert result', insertResult);
	}
	await mysql.end();
};
