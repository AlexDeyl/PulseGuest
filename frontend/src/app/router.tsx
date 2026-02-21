import { createBrowserRouter } from "react-router-dom";
import PublicSurveyPage from "../pages/PublicSurveyPage";
import AdminLoginPage from "../pages/AdminLoginPage";
import AdminDashboardPage from "../pages/AdminDashboardPage";
import AdminSubmissionsPage from "../pages/AdminSubmissionsPage";
import AdminSubmissionDetailPage from "../pages/AdminSubmissionDetailPage";
import AdminLocationSurveysPage from "../pages/AdminLocationSurveysPage";
import AdminSurveyDetailPage from "../pages/AdminSurveyDetailPage";
import AdminSurveyVersionEditorPage from "../pages/AdminSurveyVersionEditorPage";
import AdminSurveyVersionPreviewPage from "../pages/AdminSurveyVersionPreviewPage";
import AdminLocationStaysPage from "../pages/AdminLocationStaysPage"

// ✅ страницы организаций/локаций
import AdminOrganizationsPage from "../pages/AdminOrganizationsPage";
import AdminOrganizationLocationsPage from "../pages/AdminOrganizationLocationsPage";

// ✅ Patch 7.x: пользователи
import AdminUsersPage from "../pages/AdminUsersPage";
import AdminUserDetailPage from "../pages/AdminUserDetailPage";

import { ProtectedRoute } from "../shared/auth";

export const router = createBrowserRouter([
  // Root всегда ведёт в админ-логин (никакой публичной анкеты на /)
  { path: "/", element: <AdminLoginPage /> },
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
    path: "/admin/submissions",
    element: (
      <ProtectedRoute>
        <AdminSubmissionsPage />
      </ProtectedRoute>
    ),
  },

  {
    path: "/admin/survey-versions/:versionId",
    element: (
      <ProtectedRoute>
        <AdminSurveyVersionEditorPage />
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

  {
    path: "/admin/locations/:locationId/surveys/:surveyId/versions/:versionId/preview",
    element: (
      <ProtectedRoute>
        <AdminSurveyVersionPreviewPage />
      </ProtectedRoute>
    ),
  },

  {
    path: "/admin/locations/:locationId/surveys",
    element: (
      <ProtectedRoute>
        <AdminLocationSurveysPage />
      </ProtectedRoute>
    ),
  },

  {
    path: "/admin/surveys/:surveyId",
    element: (
      <ProtectedRoute>
        <AdminSurveyDetailPage />
      </ProtectedRoute>
    ),
  },

  {
    path: "/admin/locations/:locationId/stays",
    element: (
      <ProtectedRoute>
        <AdminLocationStaysPage />
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
    path: "/admin/users",
    element: (
      <ProtectedRoute>
        <AdminUsersPage />
      </ProtectedRoute>
    ),
  },

  {
    path: "/admin/users/:id",
    element: (
      <ProtectedRoute>
        <AdminUserDetailPage />
      </ProtectedRoute>
    ),
  },
]);
