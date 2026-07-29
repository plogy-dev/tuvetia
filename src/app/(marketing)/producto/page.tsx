import type { Metadata } from "next";
import ProductoPage from "@/components/subpages/ProductoPage";
import "@/app/subpages.css";

export const metadata: Metadata = {
  title: "El producto · Tuvetia",
  description:
    "Athos oye tu consulta, escribe la ficha y contesta el WhatsApp. Tú firmas. Una sola inteligencia, tres caras, conectada a todo tu día clínico.",
};

export default function Page() {
  return <ProductoPage />;
}
