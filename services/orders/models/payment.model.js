class PaymentModel {
	constructor(data) {
		this.id = data.id;
		this.amount = data.amount;
		this.currency = data.currency;
		this.status = data.status;
		this.paymentMethod = data.paymentMethod;
    this.metadata = data.metadata;
    this.originalData = data.originalData;
		this.createdAt = data.createdAt;
	}

	static fromJSON(json) {
		return new PaymentModel({
			id: json.id,
			amount: json.amount,
			currency: json.currency,
			status: json.status,
			paymentMethod: json.paymentMethod,
			metadata: json.metadata,
			originalData: json.originalData,
			createdAt: json.createdAt
		});
	}

	toJSON() {
		return {
			id: this.id,
			amount: this.amount,
			currency: this.currency,
			status: this.status,
			paymentMethod: this.paymentMethod,
			metadata: this.metadata,
			originalData: this.originalData,
			createdAt: this.createdAt
		};
	}
}
