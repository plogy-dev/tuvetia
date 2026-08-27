// Igual que en `consultas/[id]` y `patients/import`: la página es un Client Component —tiene que
// serlo, porque lo único que sabe leer el fragmento `#access_token=…` es el navegador— y un Client
// Component no puede exportar `metadata`. Este layout de servidor sólo le pone título a la pestaña
// y devuelve `children` sin envolver.
//
// El título importa más acá que en otras pantallas: se llega desde un enlace de correo, y si el
// intercambio de tokens falla la pestaña se queda un rato a la vista diciendo qué pasó. Decía
// "Tuvetia", que no ayudaba a nadie a entender dónde había aterrizado.
//
// No lleva `robots` propio como `/f/[token]` o `/baja/[token]`: `app/robots.ts` ya prohíbe `/auth`
// entero, y acá el token viaja en el fragmento, que nunca sale del navegador.

export const metadata = { title: "Completando tu ingreso · Tuvetia" }

export default function SesionDeCorreoLayout({ children }: { children: React.ReactNode }) {
  return children
}
