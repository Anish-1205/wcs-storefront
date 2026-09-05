export interface CartItem {
  slug: string;
  reference: string;
  title: string;
  colour: string;
  image: string;
  /** INR unit price, or null for "Price on Enquiry" */
  price: number | null;
  availabilityLabel: string;
  qty: number;
}

export interface CartState {
  items: CartItem[];
}
