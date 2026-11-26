import { CartStoreActionsType, CartStoreStateType } from "@/types";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

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
          const quantityToAdd = Math.max(1, product.quantity || 1);
          const existingIndex = state.cart.findIndex((item) => isSameCartLine(item, product));

          if (existingIndex !== -1) {
            return {
              cart: state.cart.map((item, index) =>
                index === existingIndex
                  ? { ...item, quantity: item.quantity + quantityToAdd }
                  : item
              ),
            };
          }

          return {
            cart: [
              ...state.cart,
              {
                ...product,
                quantity: quantityToAdd,
                selectedSize: product.selectedSize,
                selectedColor: product.selectedColor,
              },
            ],
          };
        }),
      updateQuantity: (product, quantity) =>
        set((state) => ({
          cart:
            quantity < 1
              ? state.cart.filter((item) => !isSameCartLine(item, product))
              : state.cart.map((item) =>
                  isSameCartLine(item, product) ? { ...item, quantity } : item
                ),
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
