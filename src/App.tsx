import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { Dashboard } from "./pages/Dashboard";
import { Settings } from "./pages/Settings";
import { TrashPage } from "./pages/Trash";
import { CompressorPage } from "./pages/Compressor";
import { AuthProvider } from "./contexts/AuthContext";
import { AuthGate } from "./components/AuthGate";
import { Login } from "./pages/Login";
import { SignUp } from "./pages/SignUp";

const router = createBrowserRouter([
  {
    path: "/",
    element: (
      <AuthGate>
        <AppShell />
      </AuthGate>
    ),
    children: [
      { index: true,     element: <Dashboard /> },
      { path: "settings", element: <Settings /> },
      { path: "trash",    element: <TrashPage /> },
      { path: "compressor", element: <CompressorPage /> },
    ],
  },
  { path: "/login", element: <Login /> },
  { path: "/signup", element: <SignUp /> },
]);

export default function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}
