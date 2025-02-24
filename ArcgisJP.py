#!/usr/bin/env python3
"""
Precinct Lookup GUI

This script provides a GUI tool for querying precinct information using a geocoded address.
It leverages the geopy Nominatim geocoder and an ArcGIS REST API to fetch details
such as precinct number, judge's name, and contact information.
"""

import tkinter as tk
from tkinter import messagebox
import logging
from typing import Dict

import requests
from geopy.geocoders import Nominatim
from geopy.exc import GeocoderServiceError

# Configure logging for debugging purposes.
logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")


def query_precinct(street_address: str, city: str, state: str, zip_code: str) -> Dict:
    """
    Geocode the provided address and query the ArcGIS API for precinct details.

    Args:
        street_address (str): Street address.
        city (str): City name.
        state (str): State abbreviation.
        zip_code (str): ZIP code.

    Returns:
        dict: A dictionary containing precinct attributes.

    Raises:
        ValueError: If the address cannot be geocoded or no precinct data is found.
    """
    full_address = f"{street_address}, {city}, {state} {zip_code}"
    logging.info("Geocoding address: %s", full_address)

    geolocator = Nominatim(user_agent="precinct_lookup_app")

    try:
        location = geolocator.geocode(full_address)
    except GeocoderServiceError as e:
        logging.error("Geocoding error: %s", e)
        raise ValueError(f"Geocoding error: {e}")

    if not location:
        logging.error("Address could not be geocoded.")
        raise ValueError("Address could not be geocoded.")

    lat, lon = location.latitude, location.longitude
    logging.info("Obtained coordinates: (%f, %f)", lat, lon)

    arcgis_url = (
        "https://services1.arcgis.com/Z3qsB1OAIjFLs23T/ArcGIS/rest/services/"
        "JP_Precincts_20181129/FeatureServer/0/query"
    )

    params = {
        "f": "json",
        "geometryType": "esriGeometryPoint",
        "geometry": f"{{x:{lon},y:{lat}}}",
        "spatialRel": "esriSpatialRelIntersects",
        "inSR": "4326",
        "outFields": "*",
        "returnGeometry": "false",
        "outSR": "4326"
    }

    try:
        logging.info("Querying ArcGIS API...")
        response = requests.get(arcgis_url, params=params)
        response.raise_for_status()
        data = response.json()
    except requests.exceptions.RequestException as e:
        logging.error("Error querying ArcGIS: %s", e)
        raise ValueError(f"Error querying ArcGIS: {e}")

    features = data.get("features", [])
    if not features:
        logging.error("No precinct found for the given address.")
        raise ValueError("No precinct found.")

    return features[0]["attributes"]


def get_precinct_info() -> None:
    """
    Retrieve address information from the GUI, query the precinct data,
    and display the formatted results.

    This function validates input, handles exceptions, and shows the results
    or error messages via Tkinter dialogs.
    """
    street_address = street_entry.get().strip()
    city = city_entry.get().strip()
    state = state_entry.get().strip()
    zip_code = zip_entry.get().strip()

    if not all([street_address, city, state, zip_code]):
        messagebox.showerror("Input Error", "Please fill in all address fields.")
        return

    try:
        precinct_info = query_precinct(street_address, city, state, zip_code)
    except ValueError as e:
        messagebox.showerror("Lookup Error", str(e))
        return

    precinct_number = precinct_info.get("PRECINCT")
    judge_full_name = " ".join(
        filter(None, [
            precinct_info.get("TITLE1", ""),
            precinct_info.get("FIRSTNAME1", ""),
            precinct_info.get("LASTNAME1", "")
        ])
    ).strip()

    address_line = precinct_info.get("ADDRESS1", "Address Not Found")
    city_arc = precinct_info.get("CITY1", "City Not Found")
    state_arc = precinct_info.get("STATE1", "State Not Found")
    zip_arc = precinct_info.get("ZIP1", "ZIP Not Found")
    phone = precinct_info.get("TEL1", "Phone Not Found")

    website = (
        f"https://www.dallascounty.org/government/jpcourts/{precinct_number}/"
        if precinct_number is not None else "Website Not Found"
    )

    results = (
        f"Precinct Number: {precinct_number if precinct_number is not None else 'Not Found'}\n"
        f"Judge: {judge_full_name if judge_full_name else 'Not Found'}\n"
        f"Address: {address_line}, {city_arc}, {state_arc} {zip_arc}\n"
        f"Phone: {phone}\n"
        f"Website: {website}"
    )

    messagebox.showinfo("Precinct Information", results)


def setup_gui() -> tk.Tk:
    """
    Set up and return the main Tkinter GUI window with input fields and buttons.

    Returns:
        tk.Tk: The main application window.
    """
    root = tk.Tk()
    root.title("Precinct Lookup")

    # Create labels and entry fields
    labels = [("Street Address:", 0), ("City:", 1), ("State:", 2), ("ZIP Code:", 3)]
    for text, row in labels:
        tk.Label(root, text=text).grid(row=row, column=0, sticky="e", padx=5, pady=5)

    global street_entry, city_entry, state_entry, zip_entry  # Required for callback access
    street_entry = tk.Entry(root, width=40)
    street_entry.grid(row=0, column=1, padx=5, pady=5)

    city_entry = tk.Entry(root, width=40)
    city_entry.grid(row=1, column=1, padx=5, pady=5)

    state_entry = tk.Entry(root, width=10)
    state_entry.grid(row=2, column=1, padx=5, pady=5, sticky="w")

    zip_entry = tk.Entry(root, width=10)
    zip_entry.grid(row=3, column=1, padx=5, pady=5, sticky="w")

    # Lookup button
    lookup_button = tk.Button(root, text="Lookup Precinct", command=get_precinct_info)
    lookup_button.grid(row=4, column=0, columnspan=2, pady=10)

    return root


def main() -> None:
    """
    Main function to run the Precinct Lookup GUI application.
    """
    app = setup_gui()
    app.mainloop()


if __name__ == "__main__":
    main()
