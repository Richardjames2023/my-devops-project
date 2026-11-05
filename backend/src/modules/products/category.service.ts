import prisma from "../../infrastructure/prisma/client";

export async function listActiveCategories() {
  const categories = await prisma.category.findMany({
    where: {
      isActive: true,
      products: { some: { isActive: true } },
    },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      _count: {
        select: {
          products: { where: { isActive: true } },
        },
      },
    },
  });

  return categories.map(({ _count, ...category }) => ({
    ...category,
    productCount: _count.products,
  }));
}
