import { SNS } from 'aws-sdk';

export class Sns {
	private readonly sns: SNS;

	constructor() {
		this.sns = new SNS({ region: 'us-west-2' });
	}

	public async notifyReviewPublished(review: any) {
		const topic = process.env.REVIEW_PUBLISHED_SNS_TOPIC;
		await this.sns
			.publish({
				Message: JSON.stringify(review),
				TopicArn: topic,
			})
			.promise();
	}

	public async notifyRankedReviewPublished(review: any) {
		const topic = process.env.RANKED_REVIEW_PUBLISHED_SNS_TOPIC;
		await this.sns
			.publish({
				Message: JSON.stringify(review),
				TopicArn: topic,
			})
			.promise();
	}

	public async notifyBattlegroundsReviewPublished(review: any) {
		const topic = process.env.BATTLEGROUNDS_REVIEW_PUBLISHED_SNS_TOPIC;
		console.log('publishing BG review', topic, review);
		await this.sns
			.publish({
				Message: JSON.stringify(review),
				TopicArn: topic,
			})
			.promise();
	}

	public async notifyMercenariesReviewPublished(review: any) {
		const topic = process.env.MERCENARIES_REVIEW_PUBLISHED_SNS_TOPIC;
		console.log('publishing BG review', topic, review);
		await this.sns
			.publish({
				Message: JSON.stringify(review),
				TopicArn: topic,
			})
			.promise();
	}

	public async notifyDuels12winsReviewPublished(review: any) {
		const topic = process.env.DUELS_HIGH_WINS_REVIEW_PUBLISHED_SNS_TOPIC;
		await this.sns
			.publish({
				Message: JSON.stringify(review),
				TopicArn: topic,
			})
			.promise();
	}

	public async notifyDuelsReviewPublished(review: any) {
		const topic = process.env.DUELS_REVIEW_PUBLISHED_SNS_TOPIC;
		await this.sns
			.publish({
				Message: JSON.stringify(review),
				TopicArn: topic,
			})
			.promise();
	}

	public async notifyDuelsRunEndPublished(review: any) {
		const topic = process.env.DUELS_RUN_END_PUBLISHED_SNS_TOPIC;
		await this.sns
			.publish({
				Message: JSON.stringify(review),
				TopicArn: topic,
			})
			.promise();
	}
}
