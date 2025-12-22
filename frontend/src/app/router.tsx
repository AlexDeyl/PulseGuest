import { createBrowserRouter } from "react-router-dom";
import PublicSurveyPage from "../pages/PublicSurveyPage";
import AdminLoginPage from "../pages/AdminLoginPage";
import AdminDashboardPage from "../pages/AdminDashboardPage";

export const router = createBrowserRouter([
  { path: "/", element: <PublicSurveyPage /> },
  { path: "/admin/login", element: <AdminLoginPage /> },
  { path: "/admin", element: <AdminDashboardPage /> },
]);
