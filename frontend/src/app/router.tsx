import { createBrowserRouter } from "react-router-dom";
import PublicSurveyPage from "../pages/PublicSurveyPage";
import AdminDashboardPage from "../pages/AdminDashboardPage";
import AdminSubmissionsPage from "../pages/AdminSubmissionsPage";
import AdminSubmissionDetailPage from "../pages/AdminSubmissionDetailPage";
import AdminLocationSurveysPage from "../pages/AdminLocationSurveysPage";
import AdminSurveyDetailPage from "../pages/AdminSurveyDetailPage";
import AdminSurveyVersionEditorPage from "../pages/AdminSurveyVersionEditorPage";
import AdminSurveyVersionPreviewPage from "../pages/AdminSurveyVersionPreviewPage";
import AdminLocationStaysPage from "../pages/AdminLocationStaysPage"
import AdminGroupSurveysPage from "../pages/AdminGroupSurveysPage";
import AdminLoginPage from "../pages/AdminLoginPage";
import AdminForgotPasswordPage from "../pages/AdminForgotPasswordPage";

// ✅ страницы организаций/локаций
import AdminOrganizationsPage from "../pages/AdminOrganizationsPage";
import AdminOrganizationLocationsPage from "../pages/AdminOrganizationLocationsPage";

// ✅ Patch 7.x: пользователи
import AdminUsersPage from "../pages/AdminUsersPage";
import AdminUserDetailPage from "../pages/AdminUserDetailPage";

// ✅ Patch AUDIT-1: auditor checklists UI
import AdminAuditsDashboardPage from "../pages/AdminAuditsDashboardPage";
import AdminAuditTemplatesPage from "../pages/AdminAuditTemplatesPage";
import AdminAuditHistoryPage from "../pages/AdminAuditHistoryPage";
import AdminAuditImportPage from "../pages/AdminAuditImportPage";
import AdminAuditRunPage from "../pages/AdminAuditRunPage";

import { ProtectedRoute } from "../shared/auth";
import AdminResetPasswordPage from "../pages/AdminResetPasswordPage";

export const router = createBrowserRouter([
  // Root всегда ведёт в админ-логин (никакой публичной анкеты на /)
  { path: "/", element: <AdminLoginPage /> },
  { path: "/:slug", element: <PublicSurveyPage /> },

  { path: "/admin/login", element: <AdminLoginPage /> },

  { path: "/admin/forgot-password", element: <AdminForgotPasswordPage /> },

  { path: "/admin/reset-password", element: <AdminResetPasswordPage /> },

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
    path: "/admin/group-surveys",
    element: (
      <ProtectedRoute>
        <AdminGroupSurveysPage />
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

    {
    path: "/admin/audits",
    element: (
      <ProtectedRoute>
        <AdminAuditsDashboardPage />
      </ProtectedRoute>
    ),
  },

  {
    path: "/admin/audits/templates",
    element: (
      <ProtectedRoute>
        <AdminAuditTemplatesPage />
      </ProtectedRoute>
    ),
  },

  {
    path: "/admin/audits/history",
    element: (
      <ProtectedRoute>
        <AdminAuditHistoryPage />
      </ProtectedRoute>
    ),
  },

  {
    path: "/admin/audits/import",
    element: (
      <ProtectedRoute>
        <AdminAuditImportPage />
      </ProtectedRoute>
    ),
  },

  {
    path: "/admin/audits/runs/:runId",
    element: (
      <ProtectedRoute>
        <AdminAuditRunPage />
      </ProtectedRoute>
    ),
  },
]);
