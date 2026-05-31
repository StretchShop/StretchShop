class Metadata {
  constructor(data) {
    this.type = data.type;
    this.orderId = data.orderId;
    this.subscriptionId = data.subscriptionId;
    this.productId = data.productId; // ID of product related to subscription
  }
}