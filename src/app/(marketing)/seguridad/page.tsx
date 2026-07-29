import type { Metadata } from "next";
import SeguridadPage from "@/components/subpages/SeguridadPage";
import "@/app/subpages.css";

export const metadata: Metadata = {
  title: "Datos y seguridad · Tuvetia",
  description:
    "El audio se borra a los 4 días. No entrenamos con tus datos. Nada clínico sale sin tu firma. Tus datos nunca son rehenes.",
};

export default function Page() {
  return <SeguridadPage />;
}
