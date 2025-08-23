export const productStatuses = [
  "saved", // 0 order created but not even prepared for paygate
  "prepared", // 1 order prepared for paygate
  // -- 
  "paid", // 2 product was paid, prepared for shipping
  "shipped", // 3 product was shipped
  "delivered", // 4 product was delivered
  // --
  "canceled", // 5 product order was canceled, no chance for more payments, no shipping
  "failed" // 6 something went wrong in the process
];

