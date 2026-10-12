"use client";

import {
  Store, Coffee, Pill, Stethoscope, GraduationCap, Building2,
  Scissors, BedDouble, Fuel, ShoppingBasket, Dumbbell, MapPin,
  ShoppingCart, Croissant, Shirt, Wrench, WashingMachine,
  Smartphone, Hammer, Landmark, PartyPopper,
} from "lucide-react";

/**
 * The pin a business gets on the map.
 *
 * Shared by the picker and the map itself, so what somebody chooses on
 * the form is literally the thing that appears. These are ordinary
 * building types on purpose: a map reads them as landmarks, which is
 * why an advert drawn this way does not feel like one.
 */
export const BUILDING_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  shop: Store,
  supermarket: ShoppingCart,
  cafe: Coffee,
  bakery: Croissant,
  pharmacy: Pill,
  clinic: Stethoscope,
  school: GraduationCap,
  office: Building2,
  salon: Scissors,
  tailor: Shirt,
  mechanic: Wrench,
  laundry: WashingMachine,
  electronics: Smartphone,
  hardware: Hammer,
  bank: Landmark,
  hotel: BedDouble,
  events: PartyPopper,
  fuel: Fuel,
  market: ShoppingBasket,
  gym: Dumbbell,
  // Anything that is not on the list gets a plain map pin. Still a
  // landmark, just an unlabelled one.
  other: MapPin,
};

export const buildingIcon = (id?: string | null) => BUILDING_ICONS[id || ""] || MapPin;
