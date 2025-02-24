# Precinct Lookup GUI
This Python-based GUI application provides a unified way to query the Justice of the Peace (JP) precinct number for any address within the state of Texas. While individual county courts offer their own lookup tools, this application consolidates the search into a single, user-friendly interface.

Leveraging data contributed by PB06269_TXDPS on ArcGIS, this tool allows statewide JP court precinct lookups by simply entering an address.

Important Note:

While this tool offers broad coverage, please be aware that data accuracy can vary. For example, Dallas County has multiple courts within certain precincts, which the ArcGIS data may not fully reflect. However, the precinct number is accurately provided. You may need to consult the specific JP court's website for detailed information within that precinct.


---

## Overview

Simplifies obtaining precinct information. Users enter an address, and the application:

-   Geocodes the address.
-   Queries an ArcGIS REST API.
-   Displays precinct details.

---

## Features

-   **User-Friendly Interface:** Tkinter-based.
-   **Robust Geocoding:** Uses geopy's Nominatim.
-   **Precinct Data Retrieval:** Interfaces with ArcGIS REST API.
-   **Error Handling:** Detailed error messages and logging.
-   **Modular Code:** Clear separation of functions.

---

## Requirements

-   Python 3.x
-   **Dependencies:**
    -   tkinter (included with Python)
    -   requests
    -   geopy

---

## Installation

1.  **Clone the Repository:**

    ```bash
    git clone https://github.com/D1ll4nT/Arcgis_TX_JPCourts.git
    cd Arcgis_TX_JPCourts
    ```

2.  **Install Dependencies:**

    ```bash
    pip install requests geopy
    ```

---

## Usage

1.  **Run the Script:**

    ```bash
    python3 arcgisJP.py
    ```

2.  **Enter Address Details:**
    -   Street Address
    -   City
    -   State
    -   ZIP Code

3.  **Lookup Precinct:**
    -   Click "Lookup Precinct".

---

## Code Structure

-   **`query_precinct`:**
    -   Geocodes address and queries ArcGIS API.
    -   Returns precinct attributes.
    -   Raises `ValueError` on failure.
-   **`get_precinct_info`:**
    -   Collects address input, calls `query_precinct`, and displays results.
    -   Displays errors via Tkinter dialogs.
-   **`setup_gui`:**
    -   Sets up Tkinter window with input fields and lookup button.
-   **`main`:**
    -   Initializes GUI and starts event loop.

---

## Contributing

1.  Fork the repository.
2.  Create a feature branch.
3.  Ensure well-documented code.
4.  Submit a pull request.

---

## Support

Open an issue on GitHub.
