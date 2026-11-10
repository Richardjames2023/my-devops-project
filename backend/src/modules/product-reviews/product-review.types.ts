export interface CreateProductReviewInput {
  rating: number;
  title?: string | null | undefined;
  comment: string;
}

export interface ProductReviewListQuery {
  page: number;
  limit: number;
}
