<?php
    global $databasehandler;
    require_once(__DIR__ . '/../configDB.php');

    $sql = file_get_contents(__DIR__ . '/../sql/selectemployees.sql');
    foreach ($databasehandler->query($sql) as $row) {
        print "<br/>";
        print $row['id'] . '-' . $row['fio'] . '-' . $row['hire_date'] . '-' . $row['termination_date'] . '<br/>';}
?>