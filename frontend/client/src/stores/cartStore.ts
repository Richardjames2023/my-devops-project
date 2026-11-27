import { CartStoreActionsType, CartStoreStateType } from "@/types";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

const getStockLimit = (product: { availableQuantity?: number | null; stockStatus: string }) =>
  typeof product.availableQuantity === "number"
    ? Math.max(0, Math.floor(product.availableQuantity))
    : product.stockStatus === "out-of-stock" ? 0 : Number.POSITIVE_INFINITY;

const isSameCartLine = (
  current: { id: string | number; selectedSize: string; selectedColor: string },
  target: { id: string | number; selectedSize: string; selectedColor: string }
) =>
  String(current.id) === String(target.id) &&
  current.selectedSize === target.selectedSize &&
  current.selectedColor === target.selectedColor;

const useCartStore = create<CartStoreStateType & CartStoreActionsType>()(
  persist(
    (set) => ({
      cart: [],
      hasHydrated: false,
      addToCart: (product) =>
        set((state) => {
          const stockLimit = getStockLimit(product);
          if (stockLimit === 0) return state;
          const quantityToAdd = Math.min(stockLimit, Math.max(1, Math.floor(product.quantity || 1)));
          const existingIndex = state.cart.findIndex((item) => isSameCartLine(item, product));

          if (existingIndex !== -1) {
            return {
              cart: state.cart.map((item, index) =>
                index === existingIndex
                  ? { ...item, quantity: Math.min(getStockLimit(item), item.quantity + quantityToAdd) }
                  : item
              ),
            };
          }

          return {
            cart: [
              ...state.cart,
              {
                ...product,
                quantity: Math.min(stockLimit, quantityToAdd),
                selectedSize: product.selectedSize,
                selectedColor: product.selectedColor,
              },
            ],
          };
        }),
      updateQuantity: (product, quantity) =>
        set((state) => ({
          cart: state.cart.flatMap((item) => {
            if (!isSameCartLine(item, product)) return [item];
            const nextQuantity = Math.min(getStockLimit(item), Math.floor(quantity));
            return nextQuantity < 1 ? [] : [{ ...item, quantity: nextQuantity }];
          }),
        })),
      removeFromCart: (product) =>
        set((state) => ({
          cart: state.cart.filter((item) => !isSameCartLine(item, product)),
        })),
      clearCart: () => set({ cart: [] }),
    }),
    {
      name: "cart",
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state) => {
        if (state) state.hasHydrated = true;
      },
    }
  )
);

export default useCartStore;
