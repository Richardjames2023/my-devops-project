export interface CreateProductReviewInput {
  rating: number;
  title?: string | null;
  comment: string;
}

export interface ProductReviewListQuery {
  page: number;
  limit: number;
}
