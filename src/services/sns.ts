import { SNS } from 'aws-sdk';

export class Sns {
	private readonly sns: SNS;

	constructor() {
		this.sns = new SNS({ region: 'us-west-2' });
	}

	public async notifyReviewPublished(review: any) {
		const topic = 'arn:aws:sns:us-west-2:478062583808:review-published';
		console.log('sending', review, 'to', topic);
		await this.sns
			.publish({
				Message: JSON.stringify(review),
				TopicArn: topic,
			})
			.promise();
	}

	public async notifyRankedReviewPublished(review: any) {
		const topic = 'arn:aws:sns:us-west-2:478062583808:review-published-ranked';
		console.log('sending', review, 'to', topic);
		await this.sns
			.publish({
				Message: JSON.stringify(review),
				TopicArn: topic,
			})
			.promise();
	}

	// public async notifyFirestoneReviewPublished(review: any) {
	// 	const topic = 'arn:aws:sns:us-west-2:478062583808:review-published-firestone';
	// 	console.log('sending', review, 'to', topic);
	// 	await this.sns
	// 		.publish({
	// 			Message: JSON.stringify(review),
	// 			TopicArn: topic,
	// 		})
	// 		.promise();
	// }

	public async notifyDuels12winsReviewPublished(review: any) {
		const topic = 'arn:aws:sns:us-west-2:478062583808:review-published-duels-12-wins';
		console.log('sending', review, 'to', topic);
		await this.sns
			.publish({
				Message: JSON.stringify(review),
				TopicArn: topic,
			})
			.promise();
	}
}
