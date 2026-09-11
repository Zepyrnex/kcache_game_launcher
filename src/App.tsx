import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { Dashboard } from "./pages/Dashboard";
import { Settings } from "./pages/Settings";
import { TrashPage } from "./pages/Trash";
import { JanitorPage } from "./pages/Janitor";

const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true,     element: <Dashboard /> },
      { path: "janitor", element: <JanitorPage /> },
      { path: "trash",    element: <TrashPage /> },
      { path: "settings", element: <Settings /> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
