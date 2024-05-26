<?php
    require_once(dirname(__FILE__) . '/../configDB.php');
    $sql = file_get_contents(dirname(__FILE__) . '/../sql/selectMonth.sql');
    $query = $databasehandler->query($sql);
    foreach ($query as $row) {
        print "<br/>";
        print $row['id'] . '-' . $row['name'] . '-' . $row['day'] . '-' . $row['month'] . $row['year'] . '<br/>';
    }
?>