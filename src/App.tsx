import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { Dashboard } from "./pages/Dashboard";
import { Settings } from "./pages/Settings";
import { TrashPage } from "./pages/Trash";

const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true,     element: <Dashboard /> },
      { path: "settings", element: <Settings /> },
      { path: "trash",    element: <TrashPage /> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
