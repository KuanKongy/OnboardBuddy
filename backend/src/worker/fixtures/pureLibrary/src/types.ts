export interface Posting {
  account: string;
  amount: number;
}

export interface Entry {
  id: string;
  postings: Posting[];
}

export interface Balance {
  account: string;
  total: number;
}

export type Currency = 'USD' | 'EUR';
