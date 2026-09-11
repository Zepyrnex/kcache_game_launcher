import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { Dashboard } from "./pages/Dashboard";
import { Settings } from "./pages/Settings";
import { TrashPage } from "./pages/Trash";
import { CompressorPage } from "./pages/Compressor";
import { SaveManager } from "./components/SaveManager";
import { Statistics } from "./pages/Statistics";

const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true,     element: <Dashboard /> },
      { path: "settings", element: <Settings /> },
      { path: "trash",    element: <TrashPage /> },
      { path: "compressor", element: <CompressorPage /> },
      { path: "saves",    element: <SaveManager /> },
      { path: "statistics", element: <Statistics /> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
