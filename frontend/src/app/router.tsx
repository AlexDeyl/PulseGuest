import { createBrowserRouter } from "react-router-dom";
import PublicSurveyPage from "../pages/PublicSurveyPage";
import AdminLoginPage from "../pages/AdminLoginPage";
import AdminDashboardPage from "../pages/AdminDashboardPage";
import AdminSubmissionsPage from "../pages/AdminSubmissionsPage";
import AdminSubmissionDetailPage from "../pages/AdminSubmissionDetailPage";
import AdminOrganizationsPage from "../pages/AdminOrganizationsPage";
import AdminOrganizationLocationsPage from "../pages/AdminOrganizationLocationsPage";
import { ProtectedRoute } from "../shared/auth";

export const router = createBrowserRouter([
  { path: "/", element: <PublicSurveyPage slug="main" /> },
  { path: "/:slug", element: <PublicSurveyPage /> },

  { path: "/admin/login", element: <AdminLoginPage /> },

  {
    path: "/admin",
    element: (
      <ProtectedRoute>
        <AdminDashboardPage />
      </ProtectedRoute>
    ),
  },

  {
    path: "/admin/organizations",
    element: (
      <ProtectedRoute>
        <AdminOrganizationsPage />
      </ProtectedRoute>
    ),
  },

  {
    path: "/admin/organizations/:orgId/locations",
    element: (
      <ProtectedRoute>
        <AdminOrganizationLocationsPage />
      </ProtectedRoute>
    ),
  },

  {
    path: "/admin/submissions",
    element: (
      <ProtectedRoute>
        <AdminSubmissionsPage />
      </ProtectedRoute>
    ),
  },

  {
    path: "/admin/submissions/:id",
    element: (
      <ProtectedRoute>
        <AdminSubmissionDetailPage />
      </ProtectedRoute>
    ),
  },
]);
