'use server'

import { listSopTemplatesAction as listSopTemplates } from './templates'
import {
  addVendorAction as addVendor,
  listVendorCatalogAction as listVendorCatalog,
  renameVendorAction as renameVendor,
  setVendorDefaultsAction as setVendorDefaults,
} from './vendors'
import {
  addReportTypeAction as addReportType,
  listReportCatalogAction as listReportCatalog,
  renameReportTypeAction as renameReportType,
} from './report-catalog'

export async function listSopTemplatesAction(): ReturnType<typeof listSopTemplates> {
  return listSopTemplates()
}

export async function listVendorCatalogAction(...args: Parameters<typeof listVendorCatalog>): ReturnType<typeof listVendorCatalog> {
  return listVendorCatalog(...args)
}

export async function addVendorAction(...args: Parameters<typeof addVendor>): ReturnType<typeof addVendor> {
  return addVendor(...args)
}

export async function renameVendorAction(...args: Parameters<typeof renameVendor>): ReturnType<typeof renameVendor> {
  return renameVendor(...args)
}

export async function setVendorDefaultsAction(...args: Parameters<typeof setVendorDefaults>): ReturnType<typeof setVendorDefaults> {
  return setVendorDefaults(...args)
}

export async function listReportCatalogAction(...args: Parameters<typeof listReportCatalog>): ReturnType<typeof listReportCatalog> {
  return listReportCatalog(...args)
}

export async function addReportTypeAction(...args: Parameters<typeof addReportType>): ReturnType<typeof addReportType> {
  return addReportType(...args)
}

export async function renameReportTypeAction(...args: Parameters<typeof renameReportType>): ReturnType<typeof renameReportType> {
  return renameReportType(...args)
}
