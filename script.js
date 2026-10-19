/* =========================================================
   WOODSCAN
   SUPABASE + QR + MEASUREMENT
   FIXED QR PARSER
========================================================= */


/* =========================================================
   SUPABASE CONFIG
========================================================= */

const SUPABASE_URL =
    "https://stnymeuygiyfojlxprlc.supabase.co";

const SUPABASE_KEY =
    "sb_publishable_6quouvi0nmu3uqpXEiYHqQ_z0z3t0jU";

const QR_TABLE =
    "qr_records";

const MEASUREMENT_TABLE =
    "wood_measurements";

const IMAGE_BUCKET =
    "qr-images";


const supabaseClient =
    window.supabase.createClient(
        SUPABASE_URL,
        SUPABASE_KEY
    );


let qrRecords = [];

let measurementRecords = [];



/* =========================================================
   BASIC HELPERS
========================================================= */

function $(id) {

    return document.getElementById(id);

}


function escapeHtml(value) {

    if (
        value === null ||
        value === undefined
    ) {

        return "-";

    }

    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

}


function numberFormat(value) {

    if (
        value === null ||
        value === undefined ||
        value === ""
    ) {

        return "0";

    }

    const number =
        Number(value);

    if (
        !Number.isFinite(number)
    ) {

        return escapeHtml(value);

    }

    return number.toLocaleString("th-TH");

}


function numberOneDecimal(value) {

    const number =
        Number(value);

    if (
        !Number.isFinite(number)
    ) {

        return "-";

    }

    return number.toLocaleString(
        "th-TH",
        {
            minimumFractionDigits: 1,
            maximumFractionDigits: 1
        }
    );

}


function formatDate(value) {

    if (!value) {

        return "-";

    }

    const date =
        new Date(value);

    if (
        Number.isNaN(
            date.getTime()
        )
    ) {

        return escapeHtml(value);

    }

    return date.toLocaleString(
        "th-TH",
        {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit"
        }
    );

}


// LOT จากวันที่เดียวกับคอลัมน์ DATE (เขตเวลาไทย)
function generateLOTFromDate(value) {
    if (!value) return "-";
    const raw = String(value).trim();
    // รองรับวันที่ที่แสดงเป็น DD/MM/พ.ศ. HH:mm
    const thaiDate = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (thaiDate) {
        const day = thaiDate[1].padStart(2, "0");
        const month = thaiDate[2].padStart(2, "0");
        const year = Number(thaiDate[3]) > 2400 ? Number(thaiDate[3]) - 543 : Number(thaiDate[3]);
        return `LOT-${year}${month}${day}`;
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(date);
    const get = type => parts.find(part => part.type === type)?.value || "";
    return `LOT-${get("year")}${get("month")}${get("day")}`;
}

function getQRRecordDate(record) {
    return firstValue(record, ["created_at", "scanned_at", "recorded_at", "updated_at"]);
}

function firstValue(
    object,
    keys,
    fallback = null
) {

    for (
        const key of keys
    ) {

        if (
            object &&
            object[key] !== undefined &&
            object[key] !== null &&
            object[key] !== ""
        ) {

            return object[key];

        }

    }

    return fallback;

}



/* =========================================================
   SUPABASE ERROR
========================================================= */

function readableSupabaseError(error) {

    if (!error) {

        return "Unknown Supabase error";

    }

    const message =
        error.message ||
        error.error_description ||
        JSON.stringify(error);


    if (
        message.includes("Invalid API key")
    ) {

        return `
Supabase แจ้ง Invalid API key (401)

ตรวจสอบ SUPABASE_URL และ SUPABASE_KEY
รวมถึง Project API/Data API ของ Supabase
        `;

    }


    if (
        message.includes("relation") ||
        message.includes("does not exist")
    ) {

        return `
ไม่พบตารางที่ต้องการ

ตรวจสอบ:
qr_records
wood_measurements
        `;

    }


    return message;

}



/* =========================================================
   GET RAW QR
========================================================= */

function getQRRaw(record) {

    return firstValue(
        record,
        [
            "qr_data",
            "qr_code",
            "raw_data",
            "decoded_text",
            "content",
            "data",
            "text"
        ],
        ""
    );

}



/* =========================================================
   QR PARSER
=========================================================

QR ตัวอย่างจริง:

551E2250-18302440200%R2663/4D-AA%%30%1.00%%


ความหมาย:

551
E2
250

Product Code = 551E2250
Grade       = E2
Thickness   = 25.0 mm


ส่วน:

1830
2440
200

Width  = 1830 mm
Height = 2440 mm

เลข 200 จาก dimension QR
"ไม่ใช้เป็น Thickness หลัก"
เพราะ Product Code เป็นตัวกำหนด Thickness ที่ถูกต้อง


========================================================= */

function parseQRData(raw) {

    const result = {

        productCode: "-",

        width: "-",

        height: "-",

        thickness: "-",

        lot: "-",

        quantity: "-",

        factor: "-",

        grade: "-",

        typeCode: "-",

        date: "-",

        productType: "PARTICLE BOARD"

    };


    if (!raw) {

        return result;

    }


    const text =
        String(raw).trim();



    /* =====================================================
       PRODUCT CODE
    ===================================================== */

    const productMatch =
        text.match(
            /^([A-Z0-9]+)-/i
        );


    if (productMatch) {

        result.productCode =
            productMatch[1].toUpperCase();

    }



    /* =====================================================
       PRODUCT CODE -> GRADE + THICKNESS
    =====================================================

       551E2250

       551 | E2 | 250
           |    |
           |    └── thickness code
           |
           └────── grade


       250 / 10 = 25.0 mm

    ===================================================== */

    if (
        result.productCode !== "-"
    ) {

        const productStructure =
            result.productCode.match(
                /^(\d{3})([A-Z]\d)(\d{3})$/i
            );


        if (productStructure) {

            const gradeCode =
                productStructure[2]
                    .toUpperCase();


            const thicknessCode =
                Number(
                    productStructure[3]
                );


            result.grade =
                gradeCode;


            if (
                Number.isFinite(
                    thicknessCode
                )
            ) {

                result.thickness =
                    thicknessCode / 10;

            }

        }

    }



    /* =====================================================
       DIMENSION
    =====================================================

       18302440200

       1830 = width
       2440 = height
       200  = QR dimension code

       IMPORTANT:
       ไม่ overwrite thickness จาก Product Code

    ===================================================== */

    let dimensionMatch =
        text.match(
            /-(\d{11})%/
        );


    if (dimensionMatch) {

        const dimension =
            dimensionMatch[1];


        result.width =
            dimension.substring(
                0,
                4
            );


        result.height =
            dimension.substring(
                4,
                8
            );


        /*
           เฉพาะกรณี Product Code
           ไม่มี thickness เท่านั้น
        */

        if (
            result.thickness === "-"
        ) {

            const qrThickness =
                Number(
                    dimension.substring(
                        8,
                        11
                    )
                );


            if (
                Number.isFinite(
                    qrThickness
                )
            ) {

                result.thickness =
                    qrThickness / 10;

            }

        }

    }



    /* =====================================================
       SUPPORT 1830x2440x250
    ===================================================== */

    if (
        result.width === "-"
    ) {

        const xDimension =
            text.match(
                /(\d{4})\s*[xX×]\s*(\d{4})\s*[xX×]\s*(\d{2,4})/
            );


        if (xDimension) {

            result.width =
                xDimension[1];

            result.height =
                xDimension[2];


            if (
                result.thickness === "-"
            ) {

                const rawThickness =
                    Number(
                        xDimension[3]
                    );


                if (
                    Number.isFinite(
                        rawThickness
                    )
                ) {

                    if (
                        rawThickness >= 100
                    ) {

                        result.thickness =
                            rawThickness / 10;

                    } else {

                        result.thickness =
                            rawThickness;

                    }

                }

            }

        }

    }



    /* =====================================================
       LOT
    ===================================================== */

    const lotMatch =
        text.match(
            /%([^%]+)%%/
        );


    if (lotMatch) {

        const possibleLot =
            lotMatch[1].trim();


        if (
            !/^\d+(?:\.\d+)?$/.test(
                possibleLot
            )
        ) {

            result.lot =
                possibleLot;

        }

    }



    /* =====================================================
       TYPE CODE
    =====================================================

       R2663/4D-AA

       => AA

    ===================================================== */

    if (
        result.lot !== "-"
    ) {

        const lotTypeMatch =
            result.lot.match(
                /-([A-Z]{2})$/i
            );


        if (lotTypeMatch) {

            result.typeCode =
                lotTypeMatch[1]
                    .toUpperCase();

        }

    }



    /*
       สำรอง ถ้ามี AA/AB/BA/BB อยู่ใน raw QR
    */

    if (
        result.typeCode === "-"
    ) {

        const typeMatch =
            text.match(
                /(?:^|[^A-Z])(AA|AB|BA|BB)(?:$|[^A-Z])/i
            );


        if (typeMatch) {

            result.typeCode =
                typeMatch[1]
                    .toUpperCase();

        }

    }



    /* =====================================================
       QUANTITY
    ===================================================== */

    const quantityMatch =
        text.match(
            /%%(\d+(?:\.\d+)?)%/
        );


    if (quantityMatch) {

        result.quantity =
            quantityMatch[1];

    }



    /*
       รองรับ QR ที่มี "30 PCS"
    */

    if (
        result.quantity === "-"
    ) {

        const pcsMatch =
            text.match(
                /(\d+(?:\.\d+)?)\s*(?:PCS|Pcs|pcs)\b/
            );


        if (pcsMatch) {

            result.quantity =
                pcsMatch[1];

        }

    }



    /* =====================================================
       FACTOR
    ===================================================== */

    const factorMatch =
        text.match(
            /%(\d+(?:\.\d+)?)%%$/
        );


    if (factorMatch) {

        result.factor =
            factorMatch[1];

    }



    /* =====================================================
       DATE
    ===================================================== */

    const dateMatch =
        text.match(
            /\b(\d{1,2}\/\d{1,2}\/\d{4})\b/
        );


    if (dateMatch) {

        result.date =
            dateMatch[1];

    }



    return result;

}



/* =========================================================
   IMAGE
========================================================= */

function getImagePath(record) {

    return firstValue(
        record,
        [
            "image_path",
            "image_url",
            "file_path",
            "storage_path",
            "filename",
            "file_name",
            "image",
            "qr_image",
            "photo_url"
        ],
        null
    );

}


function getImageURL(path) {

    if (!path) {

        return null;

    }


    const value =
        String(path).trim();


    if (
        value.startsWith("http://") ||
        value.startsWith("https://")
    ) {

        return value;

    }


    const cleanPath =
        value
            .replace(/^\/+/, "")
            .replace(
                /^qr-images\//i,
                ""
            );


    const {
        data
    } =
        supabaseClient
            .storage
            .from(IMAGE_BUCKET)
            .getPublicUrl(
                cleanPath
            );


    return data?.publicUrl || null;

}



/* =========================================================
   LOAD QR DATA
========================================================= */

async function loadQRData() {

    const loading =
        $("qrLoading");

    const error =
        $("qrError");

    const errorText =
        $("qrErrorText");

    const grid =
        $("qrGrid");


    if (!grid) {

        return;

    }


    loading.hidden = false;

    error.hidden = true;

    grid.innerHTML = "";


    try {

        const {
            data,
            error: supabaseError
        } =
            await supabaseClient
                .from(QR_TABLE)
                .select("*")
                .order(
                    "id",
                    {
                        ascending: false
                    }
                );


        if (supabaseError) {

            throw supabaseError;

        }


        qrRecords =
            data || [];


        updateQRSummary();


        if (
            qrRecords.length === 0
        ) {

            grid.innerHTML = `

                <div class="empty">

                    <div class="empty-icon">
                        ▣
                    </div>

                    <h3>
                        ยังไม่มีข้อมูล QR
                    </h3>

                    <p>
                        ไม่พบข้อมูลในตาราง qr_records
                    </p>

                </div>

            `;

            return;

        }


        grid.innerHTML =
            qrRecords
                .map(
                    createQRCard
                )
                .join("");


    } catch (errorObject) {

        console.error(
            "QR ERROR:",
            errorObject
        );


        error.hidden = false;


        errorText.textContent =
            readableSupabaseError(
                errorObject
            );


    } finally {

        loading.hidden = true;

    }

}



/* =========================================================
   QR SUMMARY
========================================================= */

function updateQRSummary() {

    const total =
        qrRecords.length;


    const products =
        new Set();


    qrRecords.forEach(
        record => {

            const qr =
                parseQRData(
                    getQRRaw(record)
                );


            if (
                qr.productCode !== "-"
            ) {

                products.add(
                    qr.productCode
                );

            }

        }
    );


    const latest =
        qrRecords[0];


    if ($("qrCount")) {

        $("qrCount").textContent =
            numberFormat(total);

    }


    if ($("qrSummaryCount")) {

        $("qrSummaryCount").textContent =
            numberFormat(total);

    }


    if ($("qrProducts")) {

        $("qrProducts").textContent =
            numberFormat(
                products.size
            );

    }


    if ($("qrLastScan")) {

        $("qrLastScan").textContent =
            latest
                ? formatDate(
                    firstValue(
                        latest,
                        [
                            "created_at",
                            "scanned_at",
                            "recorded_at",
                            "updated_at"
                        ]
                    )
                )
                : "-";

    }

}



/* =========================================================
   QR CARD
========================================================= */

function createQRCard(record) {

    const qr =
        parseQRData(
            getQRRaw(record)
        );


    const imagePath =
        getImagePath(record);


    const imageURL =
        getImageURL(imagePath);


    const id =
        firstValue(
            record,
            [
                "id",
                "uuid"
            ],
            "-"
        );


    const date =
        firstValue(
            record,
            [
                "created_at",
                "scanned_at",
                "recorded_at",
                "updated_at"
            ]
        );


    /*
       ถ้า database มีค่า grade/type โดยตรง
       ให้ใช้ database ก่อน
    */

    const grade =
        firstValue(
            record,
            [
                "grade",
                "board_grade",
                "emission_class"
            ],
            qr.grade
        );


    const typeCode =
        firstValue(
            record,
            [
                "type_code",
                "class_code",
                "board_type"
            ],
            qr.typeCode
        );


    let imageHTML;


    if (imageURL) {

        imageHTML = `

            <button
                class="image-button"
                onclick="openQRImage('${escapeHtml(imageURL)}')"
            >

                <img
                    src="${escapeHtml(imageURL)}"
                    alt="QR image"
                    loading="lazy"
                    onerror="
                        this.style.display='none';
                        this.parentElement.classList.add('image-load-error');
                    "
                >

                <span class="image-label">
                    ดูรูปภาพขนาดใหญ่ ↗
                </span>

            </button>

        `;

    } else {

        imageHTML = `

            <div class="no-image">

                <div>

                    <strong>
                        ไม่พบรูปภาพ
                    </strong>

                    <br>

                    <small>
                        ตรวจสอบ qr-images
                    </small>

                </div>

            </div>

        `;

    }


    return `

        <article class="qr-card">


            <div class="qr-card-header">

                <div>

                    <span class="product-label">
                        PRODUCT CODE
                    </span>

                    <h3 class="product-code">
                        ${escapeHtml(
                            qr.productCode
                        )}
                    </h3>

                </div>


                <div class="qr-card-logo">
                    W
                </div>

            </div>



            <div class="qr-card-body">


                <div class="qr-info">


                    <span class="product-badge">
                        ${escapeHtml(
                            qr.productType
                        )}
                    </span>



                    <div class="dimension">

                        <span>
                            ขนาดแผ่นไม้
                        </span>


                        <strong>

                            ${escapeHtml(
                                qr.width
                            )}

                            <i>×</i>

                            ${escapeHtml(
                                qr.height
                            )}

                            <i>×</i>

                            ${escapeHtml(
                                numberOneDecimal(
                                    qr.thickness
                                )
                            )}

                            <small>
                                mm
                            </small>

                        </strong>

                    </div>



                    <div class="info-grid">


                        <div class="info-item">

                            <span>
                                THICKNESS
                            </span>

                            <strong>
                                ${escapeHtml(
                                    numberOneDecimal(
                                        qr.thickness
                                    )
                                )} mm
                            </strong>

                        </div>



                        <div class="info-item">

                            <span>
                                SIZE
                            </span>

                            <strong>
                                ${escapeHtml(
                                    qr.width
                                )}
                                ×
                                ${escapeHtml(
                                    qr.height
                                )}
                                mm
                            </strong>

                        </div>



                        <div class="info-item">

                            <span>
                                PRODUCTION / LOT
                            </span>

                            <strong>
                                ${escapeHtml(
                                    generateLOTFromDate(date)
                                )}
                            </strong>

                        </div>



                        <div class="info-item">

                            <span>
                                QUANTITY
                            </span>

                            <strong>
                                ${escapeHtml(
                                    qr.quantity
                                )}
                                Pcs
                            </strong>

                        </div>



                        <div class="info-item">

                            <span>
                                GRADE
                            </span>

                            <strong>
                                ${escapeHtml(
                                    grade
                                )}
                            </strong>

                        </div>



                        <div class="info-item">

                            <span>
                                TYPE
                            </span>

                            <strong>
                                ${escapeHtml(
                                    typeCode
                                )}
                            </strong>

                        </div>



                        <div class="info-item">

                            <span>
                                FACTOR
                            </span>

                            <strong>
                                ${escapeHtml(
                                    qr.factor
                                )}
                            </strong>

                        </div>



                        <div class="info-item">

                            <span>
                                RECORD ID
                            </span>

                            <strong>
                                #${escapeHtml(
                                    id
                                )}
                            </strong>

                        </div>


                    </div>



                    <div class="raw-data">

                        <span>
                            RAW QR DATA
                        </span>

                        <code>
                            ${escapeHtml(
                                getQRRaw(record)
                            )}
                        </code>

                    </div>


                </div>



                <div class="qr-image">

                    ${imageHTML}

                </div>


            </div>



            <div class="qr-card-footer">

                <span>
                    ${formatDate(date)}
                </span>

                <span>
                    Supabase • QR Records
                </span>

            </div>


        </article>

    `;

}



/* =========================================================
   QR IMAGE MODAL
========================================================= */

function openQRImage(url) {

    const modal =
        $("qrImageModal");

    const image =
        $("qrModalImage");


    if (
        !modal ||
        !image
    ) {

        return;

    }


    image.src =
        url;


    modal.classList.add(
        "show"
    );

}


function closeQRImage() {

    const modal =
        $("qrImageModal");


    if (modal) {

        modal.classList.remove(
            "show"
        );

    }

}



/* =========================================================
   MEASUREMENT
========================================================= */

async function loadMeasurementData() {

    const loading =
        $("measurementLoading");

    const error =
        $("measurementError");

    const errorText =
        $("measurementErrorText");

    const table =
        $("measurementTable");


    if (!table) {

        return;

    }


    loading.hidden = false;

    error.hidden = true;


    try {

        const {
            data,
            error: supabaseError
        } =
            await supabaseClient

                .from(
                    MEASUREMENT_TABLE
                )

                .select("*")

                .order(
                    "id",
                    {
                        ascending: false
                    }
                );


        if (supabaseError) {

            throw supabaseError;

        }


        measurementRecords =
            data || [];


        updateMeasurementStats();


        renderMeasurementTable(
            measurementRecords
        );


    } catch (errorObject) {

        console.error(
            "MEASUREMENT ERROR:",
            errorObject
        );


        error.hidden = false;


        errorText.textContent =
            readableSupabaseError(
                errorObject
            );


    } finally {

        loading.hidden = true;

    }

}



/* =========================================================
   MEASUREMENT FIELDS
========================================================= */

function getActualCount(record) {

    return firstValue(
        record,
        [
            "wood_count",
            "sheet_count",
            "actual_count",
            "detected_count",
            "count"
        ],
        null
    );

}


function getHeight(record) {

    return firstValue(
        record,
        [
            "total_height",
            "height",
            "measured_height",
            "package_height"
        ],
        null
    );

}


function getStatus(record) {

    return firstValue(
        record,
        [
            "status",
            "measurement_status",
            "result_status",
            "state"
        ],
        null
    );

}


function getMeasuredDate(record) {

    return firstValue(
        record,
        [
            "measured_at",
            "created_at",
            "updated_at",
            "timestamp"
        ],
        null
    );

}



/* =========================================================
   FIND QR FOR MEASUREMENT
========================================================= */

function findQRForMeasurement(
    record
) {

    const ownQR =
        getQRRaw(record);


    if (ownQR) {

        return ownQR;

    }


    const qrID =
        firstValue(
            record,
            [
                "qr_record_id",
                "qr_id"
            ],
            null
        );


    if (
        qrID !== null
    ) {

        const found =
            qrRecords.find(
                qr =>

                    String(
                        firstValue(
                            qr,
                            [
                                "id",
                                "uuid"
                            ],
                            ""
                        )
                    )
                    ===
                    String(qrID)
            );


        if (found) {

            return getQRRaw(found);

        }

    }


    const productCode =
        firstValue(
            record,
            [
                "product_code",
                "productCode"
            ],
            null
        );


    if (productCode) {

        const found =
            qrRecords.find(
                qr => {

                    const parsed =
                        parseQRData(
                            getQRRaw(qr)
                        );


                    return (

                        String(
                            parsed.productCode
                        )
                        .toLowerCase()

                        ===

                        String(
                            productCode
                        )
                        .toLowerCase()

                    );

                }
            );


        if (found) {

            return getQRRaw(found);

        }

    }


    return "";

}



/* =========================================================
   STATUS
========================================================= */

function isCompleted(record) {

    const status =
        String(
            getStatus(record) || ""
        )
        .toLowerCase();


    return (

        status.includes("complete") ||
        status.includes("success") ||
        status.includes("completed") ||
        status.includes("pass") ||
        status.includes("ผ่าน") ||
        status.includes("เสร็จ")

    );

}


function statusHTML(status) {

    const text =
        String(
            status || ""
        );


    const lower =
        text.toLowerCase();


    if (
        lower.includes("complete") ||
        lower.includes("success") ||
        lower.includes("pass") ||
        lower.includes("ผ่าน") ||
        lower.includes("เสร็จ")
    ) {

        return `

            <span class="status success">

                ✓

                ${escapeHtml(
                    text || "Completed"
                )}

            </span>

        `;

    }


    if (
        lower.includes("process") ||
        lower.includes("กำลัง") ||
        lower.includes("ตรวจ")
    ) {

        return `

            <span class="status processing">

                ◌

                ${escapeHtml(
                    text
                )}

            </span>

        `;

    }


    return `

        <span class="status warning">

            ○

            ${escapeHtml(
                text || "Waiting"
            )}

        </span>

    `;

}



/* =========================================================
   MEASUREMENT STATS
========================================================= */

function updateMeasurementStats() {

    const total =
        measurementRecords.length;


    const completed =
        measurementRecords.filter(
            isCompleted
        ).length;


    const waiting =
        total -
        completed;


    const totalWood =
        measurementRecords.reduce(
            (
                sum,
                record
            ) => {

                const value =
                    Number(
                        getActualCount(
                            record
                        )
                    );


                if (
                    Number.isFinite(
                        value
                    )
                ) {

                    return sum + value;

                }


                return sum;

            },
            0
        );


    const heights =
        measurementRecords

            .map(
                record =>
                    Number(
                        getHeight(
                            record
                        )
                    )
            )

            .filter(
                Number.isFinite
            );


    const averageHeight =
        heights.length > 0

            ? heights.reduce(
                (
                    sum,
                    value
                ) =>
                    sum + value,
                0
            )
            /
            heights.length

            : 0;


    if ($("totalRecords")) {

        $("totalRecords").textContent =
            numberFormat(total);

    }


    if ($("totalRecords2")) {

        $("totalRecords2").textContent =
            numberFormat(total);

    }


    if ($("completedRecords")) {

        $("completedRecords").textContent =
            numberFormat(
                completed
            );

    }


    if ($("waitingRecords")) {

        $("waitingRecords").textContent =
            numberFormat(
                waiting
            );

    }


    if ($("totalWood")) {

        $("totalWood").textContent =
            numberFormat(
                totalWood
            );

    }


    if ($("avgHeight")) {

        $("avgHeight").textContent =
            numberOneDecimal(
                averageHeight
            );

    }

}



/* =========================================================
   MEASUREMENT TABLE
========================================================= */

function renderMeasurementTable(
    records
) {

    const table =
        $("measurementTable");


    if (!table) {

        return;

    }


    if (
        !records ||
        records.length === 0
    ) {

        table.innerHTML = `

            <tr>

                <td
                    colspan="10"
                    class="table-empty"
                >

                    ไม่พบข้อมูลการตรวจวัด

                </td>

            </tr>

        `;

        return;

    }


    table.innerHTML =
        records
            .map(
                (
                    record,
                    index
                ) => {

                    const qrRaw =
                        findQRForMeasurement(
                            record
                        );


                    const qr =
                        parseQRData(
                            qrRaw
                        );


                    const actualRaw =
                        getActualCount(
                            record
                        );


                    const actual =
                        Number(
                            actualRaw
                        );


                    const expected =
                        Number(
                            qr.quantity
                        );


                    let difference =
                        null;


                    if (
                        Number.isFinite(
                            actual
                        )
                        &&
                        Number.isFinite(
                            expected
                        )
                    ) {

                        difference =
                            actual -
                            expected;

                    }


                    let differenceHTML =
                        "-";


                    if (
                        difference !== null
                    ) {

                        if (
                            difference === 0
                        ) {

                            differenceHTML = `
                                <span class="diff-ok">
                                    0
                                </span>
                            `;

                        } else if (
                            difference > 0
                        ) {

                            differenceHTML = `
                                <span class="diff-error">
                                    +${numberFormat(
                                        difference
                                    )}
                                </span>
                            `;

                        } else {

                            differenceHTML = `
                                <span class="diff-error">
                                    ${numberFormat(
                                        difference
                                    )}
                                </span>
                            `;

                        }

                    }


                    const height =
                        getHeight(
                            record
                        );


                    const date =
                        getMeasuredDate(
                            record
                        );


                    const id =
                        firstValue(
                            record,
                            [
                                "id",
                                "uuid"
                            ],
                            index
                        );


                    return `

                        <tr>


                            <td>
                                ${index + 1}
                            </td>


                            <td>

                                <div class="product-cell">

                                    <strong>
                                        ${escapeHtml(
                                            qr.productCode
                                        )}
                                    </strong>

                                    <small>
                                        ${escapeHtml(
                                            qr.productType
                                        )}
                                    </small>

                                </div>

                            </td>


                            <td>
                                ${escapeHtml(
                                    generateLOTFromDate(getMeasuredDate(record))
                                )}
                            </td>


                            <td>

                                <strong>
                                    ${escapeHtml(
                                        qr.quantity
                                    )}
                                </strong>

                                แผ่น

                            </td>


                            <td>

                                ${
                                    actualRaw === null

                                        ? "-"

                                        : `${numberFormat(
                                            actual
                                        )} แผ่น`
                                }

                            </td>


                            <td>

                                ${
                                    height === null

                                        ? "-"

                                        : `${numberOneDecimal(
                                            height
                                        )} mm`
                                }

                            </td>


                            <td>

                                ${differenceHTML}

                            </td>


                            <td>

                                ${statusHTML(
                                    getStatus(record)
                                )}

                            </td>


                            <td>

                                ${formatDate(
                                    date
                                )}

                            </td>


                            <td>

                                <button
                                    class="view-button"
                                    onclick="openMeasurementModal('${escapeHtml(
                                        String(id)
                                    )}')"
                                >
                                    ดู
                                </button>

                            </td>


                        </tr>

                    `;

                }
            )
            .join("");

}



/* =========================================================
   SEARCH
========================================================= */

function searchMeasurement() {

    const input =
        $("measurementSearch");


    if (!input) {

        return;

    }


    const keyword =
        input.value
            .trim()
            .toLowerCase();


    if (!keyword) {

        renderMeasurementTable(
            measurementRecords
        );

        return;

    }


    const filtered =
        measurementRecords.filter(
            record => {

                const qr =
                    parseQRData(
                        findQRForMeasurement(
                            record
                        )
                    );


                const values = [

                    record.id,

                    qr.productCode,

                    generateLOTFromDate(getMeasuredDate(record)),

                    qr.quantity,

                    qr.width,

                    qr.height,

                    qr.thickness,

                    qr.grade,

                    qr.typeCode,

                    getActualCount(record),

                    getHeight(record),

                    getStatus(record)

                ];


                return values.some(
                    value =>

                        String(
                            value ?? ""
                        )
                        .toLowerCase()
                        .includes(
                            keyword
                        )

                );

            }
        );


    renderMeasurementTable(
        filtered
    );

}



/* =========================================================
   MEASUREMENT DETAIL
========================================================= */

function openMeasurementModal(
    id
) {

    const record =
        measurementRecords.find(
            item =>

                String(
                    firstValue(
                        item,
                        [
                            "id",
                            "uuid"
                        ],
                        ""
                    )
                )
                ===
                String(id)
        );


    if (!record) {

        return;

    }


    const qrRaw =
        findQRForMeasurement(
            record
        );


    const qr =
        parseQRData(
            qrRaw
        );


    const actual =
        getActualCount(
            record
        );


    const expected =
        Number(
            qr.quantity
        );


    const actualNumber =
        Number(actual);


    let difference =
        null;


    if (
        Number.isFinite(
            expected
        )
        &&
        Number.isFinite(
            actualNumber
        )
    ) {

        difference =
            actualNumber -
            expected;

    }


    const grade =
        firstValue(
            record,
            [
                "grade",
                "board_grade",
                "emission_class"
            ],
            qr.grade
        );


    const typeCode =
        firstValue(
            record,
            [
                "type_code",
                "class_code",
                "board_type"
            ],
            qr.typeCode
        );


    if ($("modalRecordID")) {

        $("modalRecordID").textContent =

            `Record ID #${
                firstValue(
                    record,
                    [
                        "id",
                        "uuid"
                    ],
                    "-"
                )
            }`;

    }


    if ($("measurementDetail")) {

        $("measurementDetail").innerHTML = `

            <div class="detail-grid">


                ${detailItem(
                    "PRODUCT CODE",
                    qr.productCode
                )}


                ${detailItem(
                    "PRODUCT TYPE",
                    qr.productType
                )}


                ${detailItem(
                    "WIDTH",
                    `${qr.width} mm`
                )}


                ${detailItem(
                    "HEIGHT",
                    `${qr.height} mm`
                )}


                ${detailItem(
                    "THICKNESS",
                    `${numberOneDecimal(
                        qr.thickness
                    )} mm`
                )}


                ${detailItem(
                    "GRADE",
                    grade
                )}


                ${detailItem(
                    "TYPE",
                    typeCode
                )}


                ${detailItem(
                    "PRODUCTION / LOT",
                    generateLOTFromDate(getMeasuredDate(record))
                )}


                ${detailItem(
                    "QR QUANTITY",
                    `${qr.quantity} แผ่น`
                )}


                ${detailItem(
                    "ACTUAL COUNT",
                    actual === null
                        ? "-"
                        : `${numberFormat(
                            actual
                        )} แผ่น`
                )}


                ${detailItem(
                    "TOTAL HEIGHT",
                    getHeight(record) === null
                        ? "-"
                        : `${numberOneDecimal(
                            getHeight(record)
                        )} mm`
                )}


                ${detailItem(
                    "DIFFERENCE",
                    difference === null
                        ? "-"
                        : `${difference > 0 ? "+" : ""}${numberFormat(
                            difference
                        )} แผ่น`
                )}


                ${detailItem(
                    "STATUS",
                    statusHTML(
                        getStatus(record)
                    )
                )}


                ${detailItem(
                    "MEASURED AT",
                    formatDate(
                        getMeasuredDate(
                            record
                        )
                    )
                )}

            </div>



            <div class="raw-data">

                <span>
                    RAW QR DATA
                </span>

                <code>
                    ${escapeHtml(
                        qrRaw
                    )}
                </code>

            </div>



            <div class="raw-data">

                <span>
                    DATABASE DATA
                </span>

                <code>
                    ${escapeHtml(
                        JSON.stringify(
                            record,
                            null,
                            2
                        )
                    )}
                </code>

            </div>

        `;

    }


    if ($("measurementModal")) {

        $("measurementModal")
            .classList.add(
                "show"
            );

    }

}


function detailItem(
    label,
    value
) {

    return `

        <div class="detail-item">

            <span>
                ${escapeHtml(label)}
            </span>

            <strong>
                ${value}
            </strong>

        </div>

    `;

}


function closeMeasurementModal() {

    if ($("measurementModal")) {

        $("measurementModal")
            .classList.remove(
                "show"
            );

    }

}



/* =========================================================
   INIT
========================================================= */

document.addEventListener(
    "DOMContentLoaded",
    () => {

        const page =
            document.body.dataset.page;


        /* QR PAGE */

        if (
            page === "qr"
        ) {

            loadQRData();

        }


        /* MEASUREMENT PAGE */

        if (
            page === "measurement"
        ) {

            loadMeasurementData();


            const search =
                $("measurementSearch");


            if (search) {

                search.addEventListener(
                    "input",
                    searchMeasurement
                );

            }

        }

    }
);